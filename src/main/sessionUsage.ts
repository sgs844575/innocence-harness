// Session-store usage derivations (batch 4F): the two state facts the
// reminders factory reads per turn — the session's cumulative token usage
// and whether the session continues from previously stored turns. Pure
// message-list derivations over the shared chat shape; the store wiring
// (which list to read) lives in the host glue. Live turns carry one
// completion per assistant message (the loop sums a turn's model steps
// before emitting done), and transcript hydration preserves per-turn
// completions, so summing the stored list yields the session cumulative.
import type { UsageMetadata } from "@innocenceharness/harness-providers";
import type { ChatMessage } from "../shared/ipc";

/**
 * Sums completion usage over the stored assistant messages. Missing
 * totalTokens falls back to input+output for that message; a list with no
 * usage at all yields undefined (the reminder stays unarmed).
 */
export function summarizeSessionUsage(
  messages: readonly ChatMessage[],
): UsageMetadata | undefined {
  let inputTokens = 0;
  let outputTokens = 0;
  let cachedInputTokens = 0;
  let totalTokens = 0;
  let seen = false;
  for (const message of messages) {
    const usage = message.completion?.usage;
    if (!usage) continue;
    seen = true;
    const input = usage.inputTokens ?? 0;
    const output = usage.outputTokens ?? 0;
    inputTokens += input;
    outputTokens += output;
    cachedInputTokens += usage.cachedInputTokens ?? 0;
    totalTokens += usage.totalTokens ?? input + output;
  }
  if (!seen) return undefined;
  return { inputTokens, outputTokens, cachedInputTokens, totalTokens };
}

/**
 * True when the stored list already holds a finished assistant turn. At the
 * first turn of a rebuilt session this is exactly the host-side mirror of
 * the runtime's transcript seed (runtime-session seeds only the main route;
 * the composition gates the getter to that route): a fresh session's first
 * turn holds only the current user row and a completion-less assistant
 * stub, while a resumed session hydrates prior completed turns first.
 */
export function sessionHasFinishedTurn(messages: readonly ChatMessage[]): boolean {
  return messages.some((message) => message.role === "assistant" && message.completion !== undefined);
}
