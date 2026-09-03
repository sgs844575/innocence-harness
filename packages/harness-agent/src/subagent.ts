// Subagent spawning primitive. The kernel owns session construction, so it
// provides the spawner; plugin-subagent's Task tool is a thin consumer.

import type { ExecutionScope } from "@innocenceharness/harness-tools";
import type { TurnCompletion } from "@innocenceharness/harness-providers";
import type { Message } from "@innocenceharness/harness-session";

export type SubagentStatus = "started" | "running" | "completed" | "failed" | "cancelled";

/**
 * One tool activity inside a child run. The call phase carries a one-line
 * human summary of the arguments (`title`, derived by tool-summary); the
 * result phase carries a bounded excerpt of the tool output (`result`).
 * Raw args never leave the child session.
 */
export interface SubagentToolActivity {
  name: string;
  phase: "call" | "result";
  isError?: boolean;
  /** Call-phase argument summary (file name / pattern / command head). */
  title?: string;
  /** Result-phase output excerpt, bounded by {@link TOOL_RESULT_EXCERPT_LIMIT}. */
  result?: string;
}

export interface SubagentLifecycleEvent {
  childId: string;
  parentSessionId: string;
  description: string;
  status: SubagentStatus;
  /** Correlation key of the spawning Task invocation (binds a run to the
   *  parent timeline's toolCall part); present when the loop bound a scope. */
  parentInvocationId?: string;
  /** Agent preset id and task prompt, present on the started event only. */
  agentType?: string;
  prompt?: string;
  /** Present only on the running event that reopens a completed run for a
   *  continuation (resume): consumers use it to un-terminal the run; the
   *  prompt field carries the follow-up instruction on that same event. */
  resumed?: true;
  delta?: string;
  /** Streaming reasoning text (same cadence as delta; not persisted). */
  thinkingDelta?: string;
  /** Tool activity inside the child, on running events. */
  tool?: SubagentToolActivity;
  final?: string;
  error?: string;
}

export interface SubagentLifecyclePort {
  emit(event: SubagentLifecycleEvent): void;
}

export type SubagentLifecycleListener = (event: SubagentLifecycleEvent) => void;

export type SubagentChildEvent =
  | { type: "text"; text: string }
  | { type: "thinking"; text: string }
  | { type: "toolCall"; name: string; args?: Record<string, unknown> }
  | { type: "toolResult"; name: string; isError: boolean; result?: string }
  | { type: "error"; error: string };

export type SubagentChildEventListener = (event: SubagentChildEvent) => void;

export interface SubagentOptions {
  systemPrompt: string;
  /** Tool names the child may use; "readOnly" = every readOnly tool; "all" = everything (Task itself is always excluded). */
  tools: string[] | "readOnly" | "all";
  /** Maximum loop turns for the child (default 20). */
  maxTurns?: number;
  /** Agent preset id spawning this child (shown in lifecycle projections). */
  agentType?: string;
  prompt: string;
  description?: string;
  signal?: AbortSignal;
  /**
   * Kernel-injected identity of the invocation spawning this child (the loop
   * binds it via `bindSubagentSpawner`). The child session inherits
   * sessionId/taskId/routeId from it and stamps `parentInvocationId` with its
   * invocation id. Hosts calling a spawner directly may omit it.
   */
  parentScope?: ExecutionScope;
  /**
   * 上下文继承请求（S2b）：true 时子代理携带父会话最近对话历史作答。
   * 由 loop 绑定的 spawner 依其持有的运行历史兑现；直接调用（无绑定
   * 历史）时按全新上下文降级执行。
   */
  inheritContext?: boolean;
  /**
   * Kernel-derived inherited history tail (the loop-bound spawner fills this
   * from `inheritContext`); hosts calling directly may supply it themselves.
   */
  inheritHistory?: readonly Message[];
}

/** 继承历史尾部上限：控制子代理上下文成本（近因消息优先）。 */
export const INHERIT_HISTORY_LIMIT = 50;

/**
 * 简报前导（S2b，源件 inherited-context 语义改编）：种子历史之后、任务
 * prompt 之前注入，声明继承上下文的来源与陈旧纪律。
 */
export const INHERITED_CONTEXT_BRIEFING = [
  "[Inherited context]",
  "The conversation above is inherited from your parent agent; continue its",
  "work in this workspace. Paths in the inherited context use the same",
  "relative layout you see now — verify locations with your own reads. Files",
  "may have changed since they last appear in that context: re-read before",
  "editing. Your changes affect this workspace only.",
].join("\n");

/** Bounded tail of a conversation for inheritance (most recent messages win). */
export function inheritHistoryTail(history: readonly Message[]): readonly Message[] {
  return history.length > INHERIT_HISTORY_LIMIT
    ? history.slice(history.length - INHERIT_HISTORY_LIMIT)
    : history;
}

/**
 * Sanitizes an inherited tail so the child's FIRST provider request is valid
 * on every protocol: window-head user turns holding tool results whose calls
 * fell outside the window are dropped (they would be orphans), and trailing
 * assistant turns holding unanswered tool calls are dropped (the spawning
 * call itself is always such a turn — its results land only after this
 * snapshot). Mid-window call/result adjacency is an invariant of the ledger,
 * so trimming both boundaries suffices.
 */
export function sanitizeInheritedHistory(history: readonly Message[]): readonly Message[] {
  let start = 0;
  while (start < history.length) {
    const message = history[start]!;
    const isResultTurn =
      message.role === "user" &&
      message.parts.some((part) => part.type === "toolResult") &&
      !message.parts.some((part) => part.type === "text");
    if (!isResultTurn) break;
    start += 1;
  }
  let end = history.length;
  while (end > start) {
    const message = history[end - 1]!;
    if (message.role !== "assistant" || !message.parts.some((part) => part.type === "toolCall")) {
      break;
    }
    end -= 1;
  }
  return history.slice(start, end);
}

export interface SubagentResult {
  finalText: string;
  turns: number;
  completion?: TurnCompletion;
}

/**
 * One follow-up prompt on a completed child run: the parked child session
 * (its full message history) continues under the same run id.
 */
export interface SubagentResumeInput {
  /** The completed run's id (its childId). */
  runId: string;
  /** Self-contained follow-up instruction (the child keeps its own context). */
  prompt: string;
  description?: string;
  signal?: AbortSignal;
  parentScope?: ExecutionScope;
  /** Optional lifecycle observer local to this resume. */
  onLifecycle?: SubagentLifecycleListener;
}

/** Snapshot of one spawned run in the session registry (live or terminal). */
export interface SubagentRunInfo {
  runId: string;
  agentType?: string;
  description: string;
  status: SubagentStatus;
  startedAt: number;
  finishedAt?: number;
  /** Final turn count, filled when the run settles. */
  turns?: number;
  /** Tool calls observed so far (call + result events). */
  toolCalls: number;
  /** One-line latest activity, e.g. "tool Glob result". */
  lastActivity?: string;
  /** Final report text once completed. */
  final?: string;
  /** Failure message once failed. */
  error?: string;
}

/** Handle of a detached spawn: id now, outcome via done / runs() / wait(). */
export interface SubagentRunHandle {
  runId: string;
  /** Settles with the run result; rejections are captured in the registry
   *  entry (status failed/cancelled) instead of throwing here. */
  done: Promise<SubagentResult>;
}

export interface SubagentSpawner {
  run(options: SubagentOptions): Promise<SubagentResult>;
  /**
   * Continues a completed run's child session with a follow-up prompt (same
   * run id, lifecycle reopens with a resumed running event). Rejects when the
   * run is unknown, not completed, or no longer parked (e.g. after a host
   * restart). Optional: hosts without a resumable spawner omit it.
   */
  resume?(input: SubagentResumeInput): Promise<SubagentResult>;
  /**
   * Detached spawn: returns immediately; the run keeps going after the
   * spawning tool call returns. Cancellation comes from session teardown or
   * an explicit cancel — the executor's per-call signal does not outlive the
   * call. Optional: hosts without a run registry omit it and callers degrade.
   */
  start?(options: SubagentOptions): SubagentRunHandle;
  /** Snapshot of this session's run registry (newest last). */
  runs?(): readonly SubagentRunInfo[];
  /**
   * Blocks until the run reaches a terminal status and resolves with its
   * info. `timeoutMs` omitted = wait indefinitely (repo rule: no default
   * timeout when waiting on subagents); on timeout resolves with the live
   * snapshot instead of rejecting. Unknown runId rejects.
   */
  wait?(runId: string, timeoutMs?: number): Promise<SubagentRunInfo>;
}

/**
 * Binds an invocation scope into every spawn issued through the returned
 * spawner, so children inherit the spawning call's identity without the
 * spawning tool knowing about scopes. With a history accessor (the loop
 * supplies its run ledger), `inheritContext` requests are fulfilled into a
 * bounded `inheritHistory` tail.
 */
export function bindSubagentSpawner(
  spawner: SubagentSpawner,
  scope: ExecutionScope,
  history?: () => readonly Message[],
): SubagentSpawner {
  const bindOptions = (options: SubagentOptions): SubagentOptions => {
    const inherited =
      options.inheritContext === true && history
        ? { inheritHistory: inheritHistoryTail(history()) }
        : {};
    return { ...options, parentScope: scope, ...inherited };
  };
  return {
    run: (options) => spawner.run(bindOptions(options)),
    // Resume keeps the scope binding too: the continuation inherits the
    // resuming invocation's identity (no context re-seeding — the child keeps
    // its own ledger).
    ...(spawner.resume
      ? { resume: (input: SubagentResumeInput) => spawner.resume!({ ...input, parentScope: scope }) }
      : {}),
    // Registry faces forward as-is when present; start gets the same
    // scope/history binding as run so detached children inherit identity too.
    ...(spawner.start
      ? { start: (options: SubagentOptions) => spawner.start!(bindOptions(options)) }
      : {}),
    ...(spawner.runs ? { runs: () => spawner.runs!() } : {}),
    ...(spawner.wait
      ? { wait: (runId: string, timeoutMs?: number) => spawner.wait!(runId, timeoutMs) }
      : {}),
  };
}
