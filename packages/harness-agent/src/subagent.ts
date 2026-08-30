// Subagent spawning primitive. The kernel owns session construction, so it
// provides the spawner; plugin-subagent's Task tool is a thin consumer.

import type { ExecutionScope } from "@innocenceharness/harness-tools";
import type { TurnCompletion } from "@innocenceharness/harness-providers";
import type { Message } from "@innocenceharness/harness-session";

export type SubagentStatus = "started" | "running" | "completed" | "failed" | "cancelled";

export interface SubagentLifecycleEvent {
  childId: string;
  parentSessionId: string;
  description: string;
  status: SubagentStatus;
  delta?: string;
  final?: string;
  error?: string;
}

export interface SubagentLifecyclePort {
  emit(event: SubagentLifecycleEvent): void;
}

export type SubagentLifecycleListener = (event: SubagentLifecycleEvent) => void;

export type SubagentChildEvent =
  | { type: "text"; text: string }
  | { type: "error"; error: string };

export type SubagentChildEventListener = (event: SubagentChildEvent) => void;

export interface SubagentOptions {
  systemPrompt: string;
  /** Tool names the child may use; "readOnly" = every readOnly tool; "all" = everything (Task itself is always excluded). */
  tools: string[] | "readOnly" | "all";
  /** Maximum loop turns for the child (default 20). */
  maxTurns?: number;
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

export interface SubagentSpawner {
  run(options: SubagentOptions): Promise<SubagentResult>;
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
  return {
    run: (options) => {
      const inherited =
        options.inheritContext === true && history
          ? { inheritHistory: inheritHistoryTail(history()) }
          : {};
      return spawner.run({ ...options, parentScope: scope, ...inherited });
    },
  };
}
