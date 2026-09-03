import type { PermissionEngine } from "@innocenceharness/harness-permissions";
import type { Provider } from "@innocenceharness/harness-providers";
import type { Message, MessageProcessor } from "@innocenceharness/harness-session";
import type {
  ExecutionScope,
  ExecutionScopeIdentity,
  Tool,
  ToolExecutionMiddleware,
} from "@innocenceharness/harness-tools";
import type { Context } from "@innocenceharness/kernel";
import type {
  SubagentChildEventListener,
  SubagentLifecycleEvent,
  SubagentLifecyclePort,
  SubagentResult,
  SubagentRunHandle,
  SubagentRunInfo,
} from "./subagent";
import { INHERITED_CONTEXT_BRIEFING, sanitizeInheritedHistory } from "./subagent";
import { clipToolResult, summarizeToolTitle } from "./tool-summary";
import { createRunRegistry } from "./run-registry";

// Services are typed on `Context` through declaration merging by their
// publisher (kernel ServiceTable contract). The member is live only while the
// spawner plugin fiber publishing it is active; before load and after its
// unwind the property is absent at runtime.
declare module "@innocenceharness/kernel" {
  interface Context {
    spawner: SpawnerService;
  }
}

/** Concurrent-child cap of the original AgentSession spawner (session.ts:23). */
export const SUBAGENT_CONCURRENCY = 3;

/**
 * Tools never inherited by a child session: Task would recurse, and
 * TaskStatus would query the child's own (empty) run registry.
 */
const CHILD_TOOL_EXCLUSIONS: ReadonlySet<string> = new Set(["Task", "TaskStatus"]);

let nextChildId = 0;

const TERMINAL_STATUSES = new Set<SubagentLifecycleEvent["status"]>(["completed", "failed", "cancelled"]);

function abortError(): Error {
  const error = new Error("子代理已取消");
  error.name = "AbortError";
  return error;
}

async function raceWithSignal<T>(promise: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) {
    void promise.catch(() => {});
    throw abortError();
  }
  let onAbort!: () => void;
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => reject(abortError());
    signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    return await Promise.race([promise, aborted]);
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}

/** Error logger shape shared with the harness Logger (level, message, data). */
export type SpawnerLogger = (level: "info" | "warn" | "error", msg: string, data?: unknown) => void;

/** One spawn request against the spawner service. */
export interface SpawnerSessionInput {
  /** System prompt for the child session (the agent-type prompt). */
  systemPrompt: string;
  prompt: string;
  /** Tool names the child may use; "readOnly" = every readOnly tool; "all" = everything (Task itself is always excluded). */
  tools: string[] | "readOnly" | "all";
  /** Parent state the child re-registers: processors and tool middlewares as-is, in order. */
  inherit: { processors: MessageProcessor[]; middlewares: ToolExecutionMiddleware[] };
  /** Maximum loop turns for the child (default 20). */
  maxTurns?: number;
  /** Short human-readable task summary shown in lifecycle projections. */
  description?: string;
  /** Agent preset id spawning this child (shown in lifecycle projections). */
  agentType?: string;
  /** Optional lifecycle observer local to this spawn. */
  onLifecycle?: (event: SubagentLifecycleEvent) => void;
  signal?: AbortSignal;
  /**
   * Loop-bound identity of the invocation spawning this child
   * (`bindSubagentSpawner` supplies it). The child run inherits
   * sessionId/taskId/routeId from it and stamps `parentInvocationId` with its
   * invocation id. Hosts calling the service directly may omit it.
   */
  parentScope?: ExecutionScope;
  /**
   * S2b 上下文继承：inheritContext 请求由 loop 绑定的 spawner 兑现为
   * inheritHistory（有界尾部）；直接调用方也可显式供给 inheritHistory。
   * 两者皆备时以 inheritHistory 为准并前置继承简报。
   */
  inheritContext?: boolean;
  inheritHistory?: readonly Message[];
}

/** {@link SpawnerSessionInput} plus the spawning session fallback identity. */
export interface SpawnerRunInput extends SpawnerSessionInput {
  /** Session id used when no parent scope supplies one. */
  sessionId?: string;
}

/** Child-session materials the spawner assembles per spawn (session.ts:317-356). */
export interface SpawnerChildMaterials {
  /** subagent-tools set: the tools selected from the parent set, "Task" excluded, parent order. */
  tools: readonly Tool[];
  /** subagent-inherit set: the parent's message processors, registration order. */
  processors: readonly MessageProcessor[];
  /** subagent-inherit set: the parent's tool middlewares, registration order. */
  middlewares: readonly ToolExecutionMiddleware[];
  /** Provider shared with the spawning session (never a copy). */
  provider: Provider;
  /** Permission engine shared with the spawning session: same rules, grants and mode. */
  permission: PermissionEngine;
  systemPrompt: string;
  /** Child turn cap; `maxTurns ?? 20` already applied. */
  maxTurns: number;
  logger: SpawnerLogger;
  signal?: AbortSignal;
  /** S2b：种子历史（有界父会话尾部），子会话建后、首跑前压入其账本。 */
  seedHistory?: readonly Message[];
}

/** Child session handle the spawner drives and disposes. */
export interface SpawnerChildSession {
  /** Runs the child prompt under the derived parent identity. */
  run(
    prompt: string,
    signal: AbortSignal | undefined,
    identity: ExecutionScopeIdentity,
    onEvent?: SubagentChildEventListener,
  ): Promise<SubagentResult>;
  /** Releases the child session; failures are swallowed and logged by the spawner. */
  dispose(): Promise<void>;
}

/** Host adapter constructing the child session from the spawn materials. */
export type SpawnerSessionFactory = (materials: SpawnerChildMaterials) => Promise<SpawnerChildSession>;

/**
 * Spawner service: spawns a nested agent session sharing the parent's
 * provider and permission engine with its own isolated message history. The
 * child registers the parent's message processors (minus those opting out via
 * `inheritToSubagents: false`) and tool middlewares, runs under the
 * parent-derived identity, is concurrency-capped (excess spawns wait FIFO for
 * a free slot instead of failing), and is disposed in a finally once its run
 * settles. Beyond `run` (blocking), the service tracks every spawn in a
 * session run registry: `start` detaches, `runs`/`wait`/`cancel` query and
 * control, and `drainProgress` feeds the auto progress report.
 */
export interface SpawnerService {
  run(input: SpawnerRunInput): Promise<SubagentResult>;
  /** Detached spawn: returns immediately; the run settles via the registry. */
  start(input: SpawnerRunInput): SubagentRunHandle;
  /** Snapshot of this session's run registry (oldest first). */
  runs(): readonly SubagentRunInfo[];
  /**
   * Blocks until terminal status; with `timeoutMs`, resolves with the live
   * snapshot at the deadline instead of rejecting. Unknown runId rejects.
   */
  wait(runId: string, timeoutMs?: number): Promise<SubagentRunInfo>;
  /** Aborts a live run by id; returns its snapshot. Unknown runId throws. */
  cancel(runId: string): SubagentRunInfo;
  /** Takes the pending per-run progress notes (auto-report channel). */
  drainProgress(): string[];
}

/** Constructor dependencies of the spawner plugin (per-session state). */
export interface SpawnerDeps {
  /** Host adapter building the child session (T6 adapts AgentSession here). */
  sessionFactory: SpawnerSessionFactory;
  /** Provider shared with every child session. */
  provider: Provider;
  /** Permission engine shared with every child session. */
  permission: PermissionEngine;
  /** Parent tools in registration order; tool selection runs against this set. */
  tools: readonly Tool[];
  /** Concurrent-child cap; default {@link SUBAGENT_CONCURRENCY}. */
  concurrency?: number;
  /** Optional host-neutral lifecycle event sink. */
  lifecycle?: SubagentLifecyclePort;
  /** Error sink for swallowed child dispose failures. */
  logger?: SpawnerLogger;
}

/** Shape of the spawner spine plugin (kernel Plugin contract). */
export interface SpawnerPlugin {
  readonly name: "harness-spawner";
  apply(ctx: Context): () => void;
}

/**
 * Creates the spawner spine plugin for one session (the concurrency slots, the
 * run registry, and the shared provider/engine are session state, so the
 * plugin is created per session — the permissions factory precedent). `apply`
 * publishes the service under "spawner" and returns a withdraw handle that
 * also ABORTS every live run: a session teardown must not leak detached
 * children (repo rule: explicit resource cleanup).
 */
export function createSpawnerPlugin(deps: SpawnerDeps): SpawnerPlugin {
  const concurrency = deps.concurrency ?? SUBAGENT_CONCURRENCY;
  const logger: SpawnerLogger = deps.logger ?? (() => {});
  let activeChildren = 0;
  const slotQueue: Array<() => void> = [];
  const registry = createRunRegistry();
  const emitLifecycle = (event: SubagentLifecycleEvent) => deps.lifecycle?.emit(event);

  /**
   * FIFO slot wait (the cap used to throw `子代理并发已达上限`; batch spawns
   * from one Task call must self-throttle instead of failing). Aborting the
   * run signal while queued withdraws the waiter.
   */
  const acquireSlot = (signal: AbortSignal): Promise<void> => {
    if (signal.aborted) return Promise.reject(abortError());
    if (activeChildren < concurrency) {
      activeChildren += 1;
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      const waiter = () => {
        signal.removeEventListener("abort", onAbort);
        activeChildren += 1;
        resolve();
      };
      const onAbort = () => {
        const parked = slotQueue.indexOf(waiter);
        if (parked >= 0) slotQueue.splice(parked, 1);
        reject(abortError());
      };
      slotQueue.push(waiter);
      signal.addEventListener("abort", onAbort, { once: true });
    });
  };
  /** Hands the freed slot to the oldest waiter (which then owns the count). */
  const releaseSlot = () => {
    const next = slotQueue.shift();
    if (next) next();
    else activeChildren -= 1;
  };

  /** One spawn, shared by run (blocking) and start (detached). */
  const spawn = (input: SpawnerRunInput, detached: boolean) => {
    const childId = `child_${Date.now().toString(36)}_${(nextChildId++).toString(36)}`;
    // Per-run controller: record.abort() reaches the child even after the
    // spawning tool call (and its executor-derived signal) has gone away.
    const runControl = new AbortController();
    const signal = runControl.signal;
    const linkParent = () => runControl.abort(input.signal?.reason);
    if (input.signal) {
      if (input.signal.aborted) runControl.abort(input.signal.reason);
      else input.signal.addEventListener("abort", linkParent, { once: true });
    }
    const record = registry.create({
      runId: childId,
      ...(input.agentType ? { agentType: input.agentType } : {}),
      description: input.description ?? "",
      detached,
      abort: () => runControl.abort(),
    });

    const promise = (async (): Promise<SubagentResult> => {
      try {
        await acquireSlot(signal);
      } catch (error) {
        // Never started: no lifecycle events, just a terminal registry entry.
        registry.settle(record, { status: "cancelled" });
        registry.note(record, `${childId} cancelled while queued: ${record.info.description || "(no description)"}`);
        throw error;
      }
      try {
        const parent = input.parentScope;
        const parentSessionId = parent?.sessionId ?? input.sessionId ?? "";
        const description = input.description ?? "";
        let terminal = false;
        const emit = (event: Omit<SubagentLifecycleEvent, "childId" | "parentSessionId" | "description" | "parentInvocationId">) => {
          if (TERMINAL_STATUSES.has(event.status)) {
            if (terminal) return;
            terminal = true;
          } else if (terminal) {
            return;
          }
          // Registry mirror: every lifecycle event keeps the queryable run
          // info current; detached runs additionally queue progress notes.
          record.info.status = event.status;
          if (event.tool) {
            if (event.tool.phase === "call") record.info.toolCalls += 1;
            record.info.lastActivity = `tool ${event.tool.name} ${event.tool.phase}`;
            registry.note(
              record,
              `${childId} running: ${event.tool.name} ${event.tool.phase} (${record.info.toolCalls} tool calls)`,
            );
          }
          if (event.status === "completed" || event.status === "failed" || event.status === "cancelled") {
            registry.settle(record, {
              status: event.status,
              ...(event.final !== undefined ? { final: event.final } : {}),
              ...(event.error !== undefined ? { error: event.error } : {}),
            });
            const label = description || "(no description)";
            if (event.status === "completed") {
              registry.note(record, `${childId} completed: ${label}\n${event.final ?? ""}`);
            } else if (event.status === "failed") {
              registry.note(record, `${childId} failed: ${label} — ${event.error ?? "unknown error"}`);
            } else {
              registry.note(record, `${childId} cancelled: ${label}`);
            }
          }
          const lifecycleEvent = {
            childId,
            parentSessionId,
            description,
            parentInvocationId: parent?.invocationId,
            ...event,
          };
          emitLifecycle(lifecycleEvent);
          input.onLifecycle?.(lifecycleEvent);
        };
        emit({ status: "started", agentType: input.agentType, prompt: input.prompt });
        registry.note(
          record,
          `${childId} started (${input.agentType ?? "agent"}): ${description || "(no description)"}`,
        );
        const allTools = deps.tools.filter((t) => !CHILD_TOOL_EXCLUSIONS.has(t.name));
        const selected =
          input.tools === "all"
            ? allTools
            : input.tools === "readOnly"
              ? allTools.filter((t) => t.readOnly)
              : allTools.filter((t) => input.tools.includes(t.name));
        // Same registration set as the parent: identical processor (minus
        // inheritToSubagents opt-outs) and middleware objects, in the
        // parent's registration order.
        let childPromise: Promise<SpawnerChildSession>;
        // S2b：先净化（去窗口头部孤儿结果轮/尾部未答调用轮），空结果 =
        // 无种子亦无简报（全新上下文）。
        const seedHistory = input.inheritHistory?.length
          ? sanitizeInheritedHistory(input.inheritHistory)
          : undefined;
        try {
          childPromise = Promise.resolve(deps.sessionFactory({
            tools: selected,
            processors: input.inherit.processors.filter((p) => p.inheritToSubagents !== false),
            middlewares: input.inherit.middlewares,
            provider: deps.provider,
            permission: deps.permission, // shared rules, grants and mode
            systemPrompt: input.systemPrompt,
            maxTurns: input.maxTurns ?? 20,
            logger,
            signal,
            ...(seedHistory?.length ? { seedHistory } : {}),
          }));
        } catch (error) {
          emit({ status: signal.aborted ? "cancelled" : "failed", error: error instanceof Error ? error.message : String(error) });
          throw error;
        }
        childPromise.then((lateChild) => {
          if (signal.aborted) {
            void lateChild.dispose().catch((disposeError) => {
              logger("error", "subagent child dispose failed", disposeError);
            });
          }
        }, () => {});
        let child: SpawnerChildSession;
        try {
          child = await raceWithSignal(childPromise, signal);
        } catch (error) {
          emit({ status: signal.aborted ? "cancelled" : "failed", error: error instanceof Error ? error.message : String(error) });
          throw error;
        }
        try {
          const parent = input.parentScope;
          emit({ status: "running" });
          let childFailed = false;
          const childEvent: SubagentChildEventListener = (event) => {
            if (event.type === "text" && event.text) emit({ status: "running", delta: event.text });
            if (event.type === "thinking" && event.text) emit({ status: "running", thinkingDelta: event.text });
            if (event.type === "toolCall") {
              const title = summarizeToolTitle(event.name, event.args);
              emit({ status: "running", tool: { name: event.name, phase: "call", ...(title ? { title } : {}) } });
            }
            if (event.type === "toolResult") {
              const result = clipToolResult(event.result);
              emit({
                status: "running",
                tool: { name: event.name, phase: "result", isError: event.isError, ...(result ? { result } : {}) },
              });
            }
            if (event.type === "error") {
              childFailed = true;
              emit({ status: "failed", error: event.error });
            }
          };
          // S2b：种子历史存在时任务 prompt 前置继承简报（历史已在子账本中，
          // 简报声明其来源与陈旧纪律）。
          const effectivePrompt = seedHistory?.length
            ? `${INHERITED_CONTEXT_BRIEFING}\n\n${input.prompt}`
            : input.prompt;
          const result = await child.run(effectivePrompt, signal, {
            sessionId: parent?.sessionId ?? input.sessionId,
            taskId: parent?.taskId,
            routeId: parent?.routeId,
            parentInvocationId: parent?.invocationId,
          }, childEvent);
          record.info.turns = result.turns;
          if (signal.aborted) {
            emit({ status: "cancelled" });
          } else if (childFailed || result.completion?.finishReason === "error") {
            emit({ status: "failed", ...(result.completion?.finishReason === "error" ? { error: "子代理运行失败" } : {}) });
          } else {
            emit({ status: "completed", final: result.finalText });
          }
          return {
            finalText: result.finalText,
            turns: result.turns,
            ...(childFailed
              ? { completion: result.completion ?? { finishReason: "error", aborted: false } }
              : result.completion
                ? { completion: result.completion }
                : {}),
          };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          emit({ status: signal.aborted ? "cancelled" : "failed", error: message });
          throw error;
        } finally {
          // A dispose failure must never mask the child run's own outcome —
          // log and swallow it (create's rollback path does the same).
          await child.dispose().catch((disposeError) => {
            logger("error", "subagent child dispose failed", disposeError);
          });
        }
      } finally {
        input.signal?.removeEventListener("abort", linkParent);
        releaseSlot();
      }
    })();
    return { record, promise };
  };

  const service: SpawnerService = {
    run: (input) => spawn(input, false).promise,
    start: (input) => {
      const { record, promise } = spawn(input, true);
      return {
        runId: record.info.runId,
        // The handle never rejects: failures land on the registry entry
        // (status failed/cancelled), done still yields a result shape.
        done: promise.catch(() => ({
          finalText: record.info.final ?? "",
          turns: record.info.turns ?? 0,
        })),
      };
    },
    runs: () => registry.list(),
    wait: (runId, timeoutMs) => registry.wait(runId, timeoutMs),
    cancel: (runId) => registry.cancel(runId),
    drainProgress: () => registry.drainProgress(),
  };

  return {
    name: "harness-spawner",
    apply: (ctx) => {
      const withdraw = ctx.provide("spawner", service);
      return () => {
        // Teardown cancels every live child before the service disappears.
        registry.abortActive();
        withdraw();
      };
    },
  };
}
