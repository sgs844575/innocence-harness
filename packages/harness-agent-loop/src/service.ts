import type { TraceAdapter } from "@innocenceharness/harness-ai-runtime";
import type { SubagentSpawner } from "@innocenceharness/harness-agent";
import type { PermissionEngine } from "@innocenceharness/harness-permissions";
import type { Provider } from "@innocenceharness/harness-providers";
import type {
  ContextManager,
  HarnessEventListener,
  Message,
} from "@innocenceharness/harness-session";
import type { ExecutionScopeIdentity, ToolsService } from "@innocenceharness/harness-tools";
import type { Context } from "@innocenceharness/kernel";
import { runLoop, type LoopResult } from "./loop";
import type { PendingInputMailbox } from "./pending-inputs";

// Services are typed on `Context` through declaration merging by their
// publisher (kernel ServiceTable contract). The member is live only while the
// loop plugin fiber publishing it is active; before load and after its unwind
// the property is absent at runtime.
declare module "@innocenceharness/kernel" {
  interface Context {
    loop: RunLoopFunction;
  }
}

/** Session-level wiring the loop consumes: spine services and defaults. */
export interface LoopDeps {
  /** Tools spine service consumed instead of the plugin registry. */
  tools: ToolsService;
  /** Permission engine gating every tool call (permissions spine engine). */
  permission: PermissionEngine;
  /** Provider streaming model turns (providers spine). */
  provider: Provider;
  /** Session ledger; the loop owns every push (session spine history). */
  history: Message[];
  /** System prompt for each provider turn; a function is resolved once per run. */
  systemPrompt: string | (() => string);
  /**
   * 系统提示词分段（技能索引段原文，供计量把技能单列；缺省并入系统提示词类）。
   * 懒取：与函数形态的 systemPrompt 同点解析——每次 run 组装 LoopOptions 时各取
   * 一次，分段与该 run 实际使用的最终 systemPrompt 同源同批。
   */
  systemSegments?: () => { skills?: string };
  workspaceRoot: string;
  /** Listener receiving every HarnessEvent of every run. */
  onEvent: HarnessEventListener;
  /** Session-owned compaction manager (session spine compactor). */
  compactor?: ContextManager;
  /** Spawner bound to each invocation scope with the parent identity (agent spine). */
  spawner?: SubagentSpawner;
  maxTurns?: number;
  toolTimeoutMs?: number;
  abortGraceMs?: number;
  /** Optional allow-listed observability port injected by the host. */
  telemetry?: TraceAdapter;
  /** Steer mailbox shared by every run of this session (see LoopOptions). */
  pendingInputs?: PendingInputMailbox;
}

/** Per-run options; each member overrides the {@link LoopDeps} default. */
export interface LoopRunOptions {
  signal?: AbortSignal;
  /**
   * Run-level identity inherited by every per-invocation scope minted in this
   * run (sessionId/routeId/taskId/parentInvocationId). Subagent children run
   * with the parent's identity plus the spawning invocation's id.
   */
  scope?: ExecutionScopeIdentity;
  maxTurns?: number;
  toolTimeoutMs?: number;
  abortGraceMs?: number;
}

/** Bound loop entry: one canonical user message in, one LoopResult out. */
export type RunLoopFunction = (input: Message, opts?: LoopRunOptions) => Promise<LoopResult>;

/**
 * Binds the session-level dependencies into a replaceable loop function. The
 * returned function keeps the original runLoop semantics stage for stage: the
 * canonical input (already skill-expanded and processor-run by the session)
 * enters the loop, tool-result user turns pushed by the loop itself never
 * pass through processors.
 */
export function createRunLoop(deps: LoopDeps): RunLoopFunction {
  return (input, opts = {}) =>
    runLoop(deps.history, input, {
      tools: deps.tools,
      permission: deps.permission,
      provider: deps.provider,
      // 同点解析：prompt 与 segments 在每次 run 的 LoopOptions 组装处各取一次，
      // 计量分段与该 run 的最终 systemPrompt 同源同批（冻结语义一致）。
      systemPrompt: typeof deps.systemPrompt === "function" ? deps.systemPrompt() : deps.systemPrompt,
      ...(deps.systemSegments ? { systemSegments: deps.systemSegments() } : {}),
      workspaceRoot: deps.workspaceRoot,
      onEvent: deps.onEvent,
      compactor: deps.compactor,
      signal: opts.signal,
      maxTurns: opts.maxTurns ?? deps.maxTurns,
      toolTimeoutMs: opts.toolTimeoutMs ?? deps.toolTimeoutMs,
      abortGraceMs: opts.abortGraceMs ?? deps.abortGraceMs,
      spawner: deps.spawner,
      telemetry: deps.telemetry,
      scope: opts.scope,
      pendingInputs: deps.pendingInputs,
    });
}

/** Shape of the loop spine plugin (kernel Plugin contract). */
export interface AgentLoopPlugin {
  readonly name: "harness-agent-loop";
  apply(ctx: Context): () => void;
}

/**
 * Wraps a {@link RunLoopFunction} as the loop spine plugin (boot mounting):
 * `apply` publishes it under "loop" on the scope owning the plugin context
 * and returns the withdraw handle, so the run function disappears when the
 * plugin fiber unwinds.
 */
export function createAgentLoopPlugin(deps: LoopDeps): AgentLoopPlugin {
  const run = createRunLoop(deps);
  return {
    name: "harness-agent-loop",
    apply: (ctx) => ctx.provide("loop", run),
  };
}
