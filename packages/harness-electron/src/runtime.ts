// Harness runtime: owns one AgentSession per chat-session ROUTE
// (`${sessionId}:${routeId}` — see route-cache.ts for the cache mechanics),
// rebuilds a route's session when settings change, and translates harness
// events into the host's streaming UI hooks. Types live in runtime-types.ts,
// transcript persistence in turn-persistence.ts.
import type { ExecutionScopeIdentity } from "@innocenceharness/harness-tools";
import type { Route } from "@innocenceharness/task-core";
import { AgentSession } from "./session";
import { persistTurn } from "./turn-persistence";
import { forwardHarnessEvent } from "./runtime-events";
import { RouteSessionCache, routeCacheKey } from "./route-cache";
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
 * Owns one AgentSession per chat-session route, rebuilt when settings
 * change, and translates harness events into the host's streaming UI hooks.
 */
export class HarnessRuntime {
  private readonly options: RuntimeOptions;
  private readonly cache: RouteSessionCache;
  private readonly buildContexts = new Map<string, RouteBuildContext>();

  constructor(options: RuntimeOptions) {
    this.options = options;
    this.cache = new RouteSessionCache({
      build: (key) => buildSession({
        options: this.options,
        cache: this.cache,
        buildContexts: this.buildContexts,
        nextId,
        settleDispose: (disposeKey, session) => this.settleDispose(disposeKey, session),
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
   */
  async send(request: RuntimeSendRequest): Promise<void> {
    const routeId = request.routeId || DEFAULT_ROUTE_ID;
    const key = routeCacheKey(request.sessionId, routeId);
    const controller = new AbortController();
    this.cache.startRun(key, controller);

    try {
      const agent = await this.agentFor(
        request.sessionId,
        routeId,
        request.taskId,
        request.messageId,
      );
      const historyStart = agent.history.length;
      const unsubscribe = agent.on((event) =>
        forwardHarnessEvent(this.options.hooks, request.sessionId, request.messageId, event),
      );
      try {
        const identity: ExecutionScopeIdentity = request.taskId
          ? { sessionId: request.sessionId, taskId: request.taskId, routeId }
          : { sessionId: request.sessionId, routeId };
        await agent.run(request.text, controller.signal, identity);
      } finally {
        unsubscribe();
        this.cache.endRun(key);
      }
      this.options.hooks.onCompleted(request.sessionId, request.messageId);
      await persistTurn(
        { persistDir: this.options.persistDir, log: (level, msg, data) => this.options.hooks.log(level, msg, data) },
        {
          sessionId: request.sessionId,
          turnId: request.messageId,
          routeId,
          taskId: request.taskId,
          messages: agent.history.slice(historyStart),
        },
      );
    } catch (err) {
      this.options.hooks.onError(
        request.sessionId,
        request.messageId,
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  /** Delegates durable isolated route creation to the host task adapter. */
  async forkRoute(input: RuntimeForkRouteInput): Promise<Route & { prompt: string }> {
    if (!this.options.forkRoute) throw new Error("forkRoute host port is not configured");
    return this.options.forkRoute(input);
  }
  /** Stops the active run of one route (empty routeId = the main route,
   *  like send; omitted route = every route of the chat session). */
  stop(sessionId: string, routeId?: string): void {
    if (routeId === undefined) this.cache.abortSession(sessionId);
    else this.cache.abort(routeCacheKey(sessionId, routeId || DEFAULT_ROUTE_ID));
  }

  /**
   * Releases one route's agent resources (empty routeId = the main route,
   * like send; omitted route = every route of the chat session): aborts any
   * active run, waits for it to settle and disposes the session's plugins.
   * Deleting a cache entry alone is not resource cleanup. Never rejects —
   * disposal failures are reported through the log hook. See
   * RouteSessionCache.dispose for the in-flight build/tombstone semantics.
   */
  async dispose(sessionId: string, routeId?: string): Promise<void> {
    if (routeId === undefined) await this.cache.disposeSession(sessionId);
    else await this.cache.dispose(routeCacheKey(sessionId, routeId || DEFAULT_ROUTE_ID));
  }

  /** Releases every cached agent session and every in-flight build (e.g. app shutdown). */
  async disposeAll(): Promise<void> {
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

}
