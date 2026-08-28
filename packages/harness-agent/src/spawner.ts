import type { PermissionEngine } from "@innocenceharness/harness-permissions";
import type { Provider } from "@innocenceharness/harness-providers";
import type { MessageProcessor } from "@innocenceharness/harness-session";
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
} from "./subagent";

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
 * child registers the SAME message processors and tool middlewares as the
 * spawning session, runs under the parent-derived identity, is
 * concurrency-capped, and is disposed in a finally once its run settles
 * (AgentSession.spawner semantics, session.ts:310-370).
 */
export interface SpawnerService {
  run(input: SpawnerRunInput): Promise<SubagentResult>;
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
 * Creates the spawner spine plugin for one session (the concurrency slots and
 * shared provider/engine are session state, so the plugin is created per
 * session — the permissions factory precedent). `apply` publishes the service
 * under "spawner" and returns the withdraw handle, so the service disappears
 * when the plugin fiber unwinds.
 */
export function createSpawnerPlugin(deps: SpawnerDeps): SpawnerPlugin {
  const concurrency = deps.concurrency ?? SUBAGENT_CONCURRENCY;
  const logger: SpawnerLogger = deps.logger ?? (() => {});
  let activeChildren = 0;
  const emitLifecycle = (event: SubagentLifecycleEvent) => deps.lifecycle?.emit(event);

  const service: SpawnerService = {
    run: async (input): Promise<SubagentResult> => {
      if (activeChildren >= concurrency) {
        throw new Error(`子代理并发已达上限（${concurrency}），请稍后再派生`);
      }
      activeChildren += 1;
      try {
        const childId = `child_${Date.now().toString(36)}_${(nextChildId++).toString(36)}`;
        const parent = input.parentScope;
        const parentSessionId = parent?.sessionId ?? input.sessionId ?? "";
        const description = input.description ?? "";
        let terminal = false;
        const emit = (event: Omit<SubagentLifecycleEvent, "childId" | "parentSessionId" | "description">) => {
          if (TERMINAL_STATUSES.has(event.status)) {
            if (terminal) return;
            terminal = true;
          } else if (terminal) {
            return;
          }
          const lifecycleEvent = { childId, parentSessionId, description, ...event };
          emitLifecycle(lifecycleEvent);
          input.onLifecycle?.(lifecycleEvent);
        };
        emit({ status: "started" });
        const allTools = deps.tools.filter((t) => t.name !== "Task");
        const selected =
          input.tools === "all"
            ? allTools
            : input.tools === "readOnly"
              ? allTools.filter((t) => t.readOnly)
              : allTools.filter((t) => input.tools.includes(t.name));
        // Same registration set as the parent: identical processor and
        // middleware objects, in the parent's registration order.
        let childPromise: Promise<SpawnerChildSession>;
        try {
          childPromise = Promise.resolve(deps.sessionFactory({
            tools: selected,
            processors: input.inherit.processors,
            middlewares: input.inherit.middlewares,
            provider: deps.provider,
            permission: deps.permission, // shared rules, grants and mode
            systemPrompt: input.systemPrompt,
            maxTurns: input.maxTurns ?? 20,
            logger,
            signal: input.signal,
          }));
        } catch (error) {
          emit({ status: input.signal?.aborted ? "cancelled" : "failed", error: error instanceof Error ? error.message : String(error) });
          throw error;
        }
        childPromise.then((lateChild) => {
          if (input.signal?.aborted) {
            void lateChild.dispose().catch((disposeError) => {
              logger("error", "subagent child dispose failed", disposeError);
            });
          }
        }, () => {});
        let child: SpawnerChildSession;
        try {
          child = await raceWithSignal(childPromise, input.signal);
        } catch (error) {
          emit({ status: input.signal?.aborted ? "cancelled" : "failed", error: error instanceof Error ? error.message : String(error) });
          throw error;
        }
        try {
          const parent = input.parentScope;
          emit({ status: "running" });
          let childFailed = false;
          const childEvent: SubagentChildEventListener = (event) => {
            if (event.type === "text" && event.text) emit({ status: "running", delta: event.text });
            if (event.type === "error") {
              childFailed = true;
              emit({ status: "failed", error: event.error });
            }
          };
          const result = await child.run(input.prompt, input.signal, {
            sessionId: parent?.sessionId ?? input.sessionId,
            taskId: parent?.taskId,
            routeId: parent?.routeId,
            parentInvocationId: parent?.invocationId,
          }, childEvent);
          if (input.signal?.aborted) {
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
          emit({ status: input.signal?.aborted ? "cancelled" : "failed", error: message });
          throw error;
        } finally {
          // A dispose failure must never mask the child run's own outcome —
          // log and swallow it (create's rollback path does the same).
          await child.dispose().catch((disposeError) => {
            logger("error", "subagent child dispose failed", disposeError);
          });
        }
      } finally {
        activeChildren -= 1;
      }
    },
  };

  return {
    name: "harness-spawner",
    apply: (ctx) => ctx.provide("spawner", service),
  };
}
