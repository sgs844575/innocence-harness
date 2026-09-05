import type { ExecutionScope } from "./execution-scope";
import type { ToolContext, ToolResult } from "./tool";

export type ToolActivityOutcome = "success" | "error" | "cancelled";
export interface ToolActivityStart {
  toolName: string;
  scope: ExecutionScope;
  signal: AbortSignal;
}
export type FinishToolActivity = (outcome: ToolActivityOutcome) => void;
export interface ToolActivityObserver {
  begin(activity: ToolActivityStart): FinishToolActivity | Promise<FinishToolActivity>;
}

/** Optional host presentation runs around the tool body, after access checks. */
export async function observeToolActivity(
  observer: ToolActivityObserver | undefined,
  toolName: string,
  context: ToolContext,
  execute: () => Promise<ToolResult>,
): Promise<ToolResult> {
  context.signal.throwIfAborted();
  let finish: FinishToolActivity | undefined;
  let outcome: ToolActivityOutcome = "error";
  try {
    try {
      finish = await observer?.begin({ toolName, scope: context.scope, signal: context.signal });
    } catch {
      context.log("warn", "Tool activity presentation unavailable");
    }
    context.signal.throwIfAborted();
    const result = await execute();
    outcome = result.isError ? "error" : "success";
    return result;
  } finally {
    try { finish?.(context.signal.aborted ? "cancelled" : outcome); } catch {
      context.log("warn", "Tool activity presentation could not settle");
    }
  }
}
