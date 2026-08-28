// Subagent spawning primitive. The kernel owns session construction, so it
// provides the spawner; plugin-subagent's Task tool is a thin consumer.

import type { ExecutionScope } from "@innocenceharness/harness-tools";
import type { TurnCompletion } from "@innocenceharness/harness-providers";

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
 * spawning tool knowing about scopes.
 */
export function bindSubagentSpawner(
  spawner: SubagentSpawner,
  scope: ExecutionScope,
): SubagentSpawner {
  return {
    run: (options) => spawner.run({ ...options, parentScope: scope }),
  };
}
