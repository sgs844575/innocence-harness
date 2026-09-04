// Harness runtime: owns one AgentSession per chat-session ROUTE
// (`${sessionId}:${routeId}` — see route-cache.ts for the cache mechanics),
// rebuilds a route's session when settings change, and translates harness
// events into the host's streaming UI hooks. Types live in runtime-types.ts,
// transcript persistence in turn-persistence.ts.
import type { TurnCompletion } from "@innocenceharness/harness-providers";
import type { ExecutionScopeIdentity } from "@innocenceharness/harness-tools";
import type { Route } from "@innocenceharness/task-core";
import type { Message } from "@innocenceharness/harness-session";
import { createPendingInputMailbox, type PendingInputMailbox } from "@innocenceharness/harness-agent-loop";
import { AgentSession } from "./session";
import { persistTurn, persistTurnSnapshot } from "./turn-persistence";
import { forwardHarnessEvent } from "./runtime-events";
import { RouteSessionCache, routeCacheKey, routeKeyPrefix, sessionDisposedError } from "./route-cache";
import { buildSession, type RouteBuildContext } from "./runtime-session";
import {
  DEFAULT_ROUTE_ID,
  type RuntimeForkRouteInput,
  type RuntimeOptions,
  type RuntimeSendRequest,
} from "./runtime-types";

export * from "./runtime-types";
export {
  IN_FLIGHT_BUILD_DISPOSE_TIMEOUT_MS,
  routeCacheKey,
} from "./route-cache";

let seq = 0;
const nextId = (prefix: string) => `${prefix}_${Date.now().toString(36)}_${(seq++).toString(36)}`;

/**
 * A send parked behind a busy route (queue FIFO entry / steer mailbox data):
 * settle() resolves the parked send() promise exactly once — when the
 * request's own turn settles, or immediately when dispose drops it.
 */
interface ParkedSend {
  request: RuntimeSendRequest;
  settle(): void;
}

/**
 * Owns one AgentSession per chat-session route, rebuilt when settings
 * change, and translates harness events into the host's streaming UI hooks.
 */
export class HarnessRuntime {
  private readonly options: RuntimeOptions;
  private readonly cache: RouteSessionCache;
  private readonly buildContexts = new Map<string, RouteBuildContext>();
  /** Per-route FIFO of sends parked while the route runs a turn (queue lane). */
  private readonly queues = new Map<string, ParkedSend[]>();
  /** Per-route steer mailboxes, shared by every session build of the key. */
  private readonly pendingInputs = new Map<string, PendingInputMailbox>();
  /** Steer sends parked during the currently active run of each route
   *  (same ParkedSend objects the mailbox carries as data). */
  private readonly steerParked = new Map<string, ParkedSend[]>();

  constructor(options: RuntimeOptions) {
    this.options = options;
    this.cache = new RouteSessionCache({
      build: (key) => buildSession({
        options: this.options,
        cache: this.cache,
        buildContexts: this.buildContexts,
        nextId,
        settleDispose: (disposeKey, session) => this.settleDispose(disposeKey, session),
        pendingInputsFor: (pendingKey) => this.mailboxFor(pendingKey),
      }, key),
      settleDispose: (key, session) => this.settleDispose(key, session),
      log: (level, msg, data) => this.options.hooks.log(level, msg, data),
    });
  }

  /**
   * Runs one agent turn on the request's route. `messageId` is supplied by
   * the host so the IPC handler can return it synchronously before the turn
   * completes. Task identity (non-empty taskId) is stamped on every tool
   * invocation scope of the run, so task middleware can attribute effects.
   *
   * A send targeting a BUSY route never starts a second concurrent run (a
   * mid-run send once silently corrupted the shared history): queue mode
   * parks the request in the route's FIFO and it auto-starts when the active
   * run settles; steer mode parks it in the running loop's mailbox for
   * mid-run injection, and whatever the run never drained becomes an ordinary
   * queued follow-up at settle. The send() promise of a parked request keeps
   * the standing contract — it resolves only when the request's own turn has
   * settled (the injecting run for a drained steer, the follow-up run for a
   * queued one, immediately with onError when dispose drops it).
   */
  async send(request: RuntimeSendRequest): Promise<void> {
    const routeId = request.routeId || DEFAULT_ROUTE_ID;
    const key = routeCacheKey(request.sessionId, routeId);
    // A disposing route (tombstoned mid-build) must NOT queue: the running
    // entry belongs to a doomed build that may never settle, so its queue
    // would park forever — fall through and fail fast on the tombstone.
    if (this.cache.isRunning(key) && !this.cache.isDisposing(key)) {
      return new Promise<void>((resolve) => {
        const parked: ParkedSend = { request, settle: resolve };
        if ((request.interactionMode ?? "queue") === "steer") {
          this.steerIntoRun(key, parked);
        } else {
          this.enqueue(key, parked);
        }
      });
    }
    request.onDisposition?.("started");
    const controller = new AbortController();
    let routeTrace: ReturnType<NonNullable<RuntimeOptions["telemetry"]>["startSessionRoute"]> | undefined;
    this.cache.startRun(key, controller);

    try {
      const agent = await this.agentFor(
        request.sessionId,
        routeId,
        request.taskId,
        request.messageId,
      );
      const historyStart = agent.history.length;
      routeTrace = this.options.telemetry?.startSessionRoute({
        sessionId: request.sessionId,
        ...(request.taskId ? { taskId: request.taskId } : {}),
        routeId,
        messageId: request.messageId,
        message: request.text,
      });
      let fatalError: string | undefined;
      let doneCompletion: TurnCompletion | undefined;
      // Real-time persistence options (same file resolution as the final row):
      // the user prompt row lands before the turn runs, and every structural
      // event boundary refreshes an interim snapshot. All snapshots share the
      // turn's id, which the decoder folds last-wins into the final row.
      const persistence = {
        persistDir: this.options.persistDir,
        fileFor: this.options.transcriptFileFor,
        log: (level: "warn", msg: string, data?: unknown) => this.options.hooks.log(level, msg, data),
      } as const;
      await persistTurnSnapshot(persistence, {
        sessionId: request.sessionId,
        turnId: request.messageId,
        routeId,
        messages: [typeof request.text === "string"
          ? { role: "user", parts: [{ type: "text", text: request.text }] }
          : { role: request.text.role, parts: [...request.text.parts] }],
      });
      const unsubscribe = agent.on((event) => {
        if (event.type === "error" && event.fatal) fatalError = event.message;
        if (event.type === "done") doneCompletion = event.completion;
        if (event.type === "toolCall" || event.type === "toolResult") {
          void persistTurnSnapshot(persistence, {
            sessionId: request.sessionId,
            turnId: request.messageId,
            routeId,
            messages: agent.history.slice(historyStart),
          }).catch(() => {
            // Best-effort snapshots: the final row remains the authority.
          });
        }
        forwardHarnessEvent(this.options.hooks, request.sessionId, request.messageId, event);
      });
      let summary;
      try {
        const identity: ExecutionScopeIdentity = request.taskId
          ? { sessionId: request.sessionId, taskId: request.taskId, routeId }
          : { sessionId: request.sessionId, routeId };
        summary = await agent.run(request.text, controller.signal, identity);
      } finally {
        unsubscribe();
      }
      const completionBase = doneCompletion ?? summary.completion;
      const completion = fatalError
        ? { ...completionBase, finishReason: "error" as const, aborted: false }
        : completionBase;
      const turnMessages = agent.history.slice(historyStart);
      await persistTurn(persistence, {
        sessionId: request.sessionId,
        turnId: request.messageId,
        routeId,
        messages: turnMessages,
        completion,
      });
      routeTrace?.complete({
        ...completion,
        response: turnMessages,
        ...(fatalError ? { error: fatalError } : {}),
      });
      this.options.hooks.onCompleted(request.sessionId, request.messageId, completion);
      if (fatalError) {
        this.options.hooks.onError(request.sessionId, request.messageId, fatalError);
      }
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      routeTrace?.complete({
        finishReason: controller.signal.aborted ? "aborted" : "error",
        aborted: controller.signal.aborted,
        error,
      });
      this.options.hooks.onError(
        request.sessionId,
        request.messageId,
        error,
      );
    } finally {
      // endRun + the queue/steer continuation live in ONE outer finally:
      // a build failure (agentFor throw) reaches here too, so the busy face
      // never pins a dead route, and advanceRoute's startRun lands in the
      // same synchronous stretch (isRouteRunning has no idle gap while
      // parked work remains).
      this.cache.endRun(key);
      this.advanceRoute(key);
    }
  }

  /** Delegates durable isolated route creation to the host task adapter. */
  async forkRoute(input: RuntimeForkRouteInput): Promise<Route & { prompt: string }> {
    if (!this.options.forkRoute) throw new Error("forkRoute host port is not configured");
    return this.options.forkRoute(input);
  }
  /** Whether one route currently runs a turn (empty routeId = the main
   *  route, like send) — the busy face peer routing refuses fail-fast on
   *  instead of corrupting the session with a second concurrent run. */
  isRouteRunning(sessionId: string, routeId?: string): boolean {
    return this.cache.isRunning(routeCacheKey(sessionId, routeId || DEFAULT_ROUTE_ID));
  }

  /**
   * Rewinds one route's in-memory history to its first `keptUserTurns` user
   * turns (a turn starts at a user message carrying text — the loop's
   * canonical input shape; tool-result user turns never start a turn). The
   * edit-and-resend flow uses this so the model context drops the replaced
   * turn before the new one runs. A route without a cached session is a no-op
   * (its rebuild seeds from the rewritten transcript); a running route and a
   * kept count at or beyond the live turns both leave the history untouched.
   */
  rewindHistory(sessionId: string, keptUserTurns: number, routeId?: string): void {
    const key = routeCacheKey(sessionId, routeId || DEFAULT_ROUTE_ID);
    if (this.cache.isRunning(key)) {
      throw new Error(`route is running (${key}); rewind refused`);
    }
    const cached = this.cache.peek(key);
    if (!cached) return;
    const history = cached.session.history;
    let turns = 0;
    let cut = history.length;
    for (let index = 0; index < history.length; index += 1) {
      const message = history[index]!;
      const startsTurn =
        message.role === "user" &&
        message.parts.some((part) => part.type === "text" && part.text.length > 0);
      if (!startsTurn) continue;
      if (turns >= keptUserTurns) {
        cut = index;
        break;
      }
      turns += 1;
    }
    history.length = cut;
  }

  /** Stops the active run of one route (empty routeId = the main route,
   *  like send; omitted route = every route of the chat session). */
  stop(sessionId: string, routeId?: string): void {
    if (routeId === undefined) this.cache.abortSession(sessionId);
    else this.cache.abort(routeCacheKey(sessionId, routeId || DEFAULT_ROUTE_ID));
  }

  /**
   * Cancels one spawned subagent of a chat session by its lifecycle childId.
   * The child belongs to exactly one route session (each route mounts its own
   * spawner registry keyed by that id), so try every cached route until one
   * reports a live entry. False = no live registry entry anywhere (already
   * terminal, foreign id, or no session built).
   */
  cancelSubagent(sessionId: string, childId: string): boolean {
    for (const session of this.cache.sessionsOf(sessionId)) {
      if (session.cancelSubagent(childId)) return true;
    }
    return false;
  }

  /**
   * Releases one route's agent resources (empty routeId = the main route,
   * like send; omitted route = every route of the chat session): aborts any
   * active run, waits for it to settle and disposes the session's plugins.
   * Deleting a cache entry alone is not resource cleanup. Never rejects —
   * disposal failures are reported through the log hook. See
   * RouteSessionCache.dispose for the in-flight build/tombstone semantics.
   *
   * Queued sends and parked steer inputs of the disposed route(s) are DROPPED
   * first — explicit user intent outlives a stop but not the session itself;
   * each dropped send settles through onError (the same fail-fast error a
   * send on a disposed route gets) so its host-side placeholder never hangs.
   */
  async dispose(sessionId: string, routeId?: string): Promise<void> {
    if (routeId === undefined) {
      this.dropRouteIntents(routeKeyPrefix(sessionId));
      await this.cache.disposeSession(sessionId);
    } else {
      const key = routeCacheKey(sessionId, routeId || DEFAULT_ROUTE_ID);
      this.dropRouteIntents(key, true);
      await this.cache.dispose(key);
    }
  }

  /** Releases every cached agent session and every in-flight build (e.g. app shutdown). */
  async disposeAll(): Promise<void> {
    this.dropRouteIntents("");
    await this.cache.disposeAll();
  }

  private async settleDispose(key: string, session: AgentSession): Promise<void> {
    this.buildContexts.delete(key);
    try {
      await session.dispose();
    } catch (err) {
      this.options.hooks.log("error", "session dispose failed", `${key}: ${String(err)}`);
    }
  }

  private async agentFor(
    sessionId: string,
    routeId: string,
    taskId: string,
    messageId: string,
  ): Promise<AgentSession> {
    const key = routeCacheKey(sessionId, routeId);
    const context: RouteBuildContext = { sessionId, routeId, taskId, messageId };
    // The initiating send's context wins: the cache calls build(key)
    // synchronously when no build is in flight, so the context is always
    // set before the (single, deduplicated) build reads it.
    this.buildContexts.set(key, context);
    try {
      return await this.cache.agentFor(key);
    } catch (err) {
      // A failed build must not pin its context: the next send overwrites
      // it anyway, but deleting keeps failed keys from accumulating.
      if (this.buildContexts.get(key) === context) this.buildContexts.delete(key);
      throw err;
    }
  }

  /** The route key's steer mailbox, created on first session build. */
  private mailboxFor(key: string): PendingInputMailbox {
    let mailbox = this.pendingInputs.get(key);
    if (!mailbox) {
      mailbox = createPendingInputMailbox();
      this.pendingInputs.set(key, mailbox);
    }
    return mailbox;
  }

  /** Queue lane: park the send in the route's FIFO (drained at run settle). */
  private enqueue(key: string, parked: ParkedSend): void {
    const queue = this.queues.get(key) ?? [];
    queue.push(parked);
    this.queues.set(key, queue);
    parked.request.onDisposition?.("queued");
  }

  /**
   * Steer lane: park the message in the running loop's mailbox. Only the
   * session built for THIS route key drains that mailbox, so injection
   * always lands in a run of the same route session. The mailbox is created
   * eagerly here: a steer can arrive while the route's session build is
   * still in flight (the build binds the same mailbox when it lands). A
   * session that never drains (a replaced agentFactory build) simply leaves
   * the input for the settle upgrade — it becomes a queued follow-up.
   */
  private steerIntoRun(key: string, parked: ParkedSend): void {
    const request = parked.request;
    const message: Message = typeof request.text === "string"
      ? { role: "user", parts: [{ type: "text", text: request.text }] }
      : { role: request.text.role, parts: [...request.text.parts] };
    this.mailboxFor(key).push(message, parked);
    const list = this.steerParked.get(key) ?? [];
    list.push(parked);
    this.steerParked.set(key, list);
    request.onDisposition?.("steered");
  }

  /**
   * Run-settle continuation of one route, called synchronously with endRun so
   * isRouteRunning never shows an idle gap while parked work remains: steers
   * the run DRAINED mid-run settle their parked send() promises (their
   * messages rode the just-settled turn); steers it never drained become
   * ordinary queued follow-ups (user intent outlives the run — including an
   * aborted one: stop() halts the current turn only, the queue still runs);
   * then the FIFO head starts and its own send() settles the parked promise.
   */
  private advanceRoute(key: string): void {
    const remainder = this.pendingInputs.get(key)?.drain() ?? [];
    const remainderSet = new Set(remainder.map((input) => input.data));
    const parkedSteers = this.steerParked.get(key) ?? [];
    this.steerParked.delete(key);
    for (const parked of parkedSteers) {
      if (!remainderSet.has(parked)) parked.settle();
    }
    for (const input of remainder) {
      const parked = input.data as ParkedSend | undefined;
      if (parked) this.enqueue(key, parked);
    }
    const queue = this.queues.get(key);
    const next = queue?.shift();
    if (queue && queue.length === 0) this.queues.delete(key);
    if (next) void this.send(next.request).then(next.settle, next.settle);
  }

  /**
   * Drops parked sends/steer inputs of the matched routes (dispose paths).
   * `exact` matches one route key; otherwise `match` is a key prefix (""
   * sweeps all). Dropped requests settle through onError (so host-side
   * assistant placeholders never hang) and their parked send() promises
   * resolve; steers already injected into a live turn settle silently — the
   * aborted turn's own completion covers them.
   */
  private dropRouteIntents(match: string, exact = false): void {
    const matches = (key: string) => (exact ? key === match : key.startsWith(match));
    const dropped: ParkedSend[] = [];
    const silent: ParkedSend[] = [];
    for (const [key, queue] of this.queues) {
      if (matches(key)) {
        dropped.push(...queue);
        this.queues.delete(key);
      }
    }
    for (const [key, mailbox] of this.pendingInputs) {
      if (!matches(key)) continue;
      const remainderSet = new Set<unknown>();
      for (const input of mailbox.drain()) {
        if (input.data) {
          remainderSet.add(input.data);
          dropped.push(input.data as ParkedSend);
        }
      }
      for (const parked of this.steerParked.get(key) ?? []) {
        if (!remainderSet.has(parked)) silent.push(parked);
      }
      this.steerParked.delete(key);
      this.pendingInputs.delete(key);
    }
    for (const parked of dropped) {
      const { request } = parked;
      const key = routeCacheKey(request.sessionId, request.routeId || DEFAULT_ROUTE_ID);
      this.options.hooks.onError(request.sessionId, request.messageId, sessionDisposedError(key).message);
      parked.settle();
    }
    for (const parked of silent) parked.settle();
  }

}
