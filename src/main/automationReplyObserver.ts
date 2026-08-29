// Automation reply observer: collects the assistant text deltas of one
// automation-injected turn so the dispatch adapter can read the reply after
// `runtime.send` resolves (send awaits the whole turn but returns no text;
// the runtime hooks mirror every delta through here). Only message ids that
// were explicitly begun are tracked — normal chat deltas are ignored, and an
// ended id is removed again so the map never grows per turn.
const observedReplies = new Map<string, string>();

/** Starts collecting deltas for one automation message id (resets any stale entry). */
export function beginObservedReply(messageId: string): void {
  observedReplies.set(messageId, "");
}

/** Appends one delta; a no-op for ids that were never begun (or already ended). */
export function appendObservedReplyDelta(messageId: string, delta: string): void {
  if (!observedReplies.has(messageId)) return;
  observedReplies.set(messageId, (observedReplies.get(messageId) ?? "") + delta);
}

/** Ends collection and returns the joined reply text (empty for unknown ids). */
export function endObservedReply(messageId: string): string {
  const text = observedReplies.get(messageId) ?? "";
  observedReplies.delete(messageId);
  return text;
}
