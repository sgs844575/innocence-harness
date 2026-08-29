// Automation reply observer: collects the assistant text deltas of one
// automation-injected turn so the dispatch adapter can read the reply after
// `runtime.send` resolves (send awaits the whole turn but returns no text and
// never rejects; the runtime hooks mirror every delta through here). Only
// message ids that were explicitly begun are tracked — normal chat deltas are
// ignored, and an ended id is removed again so the map never grows per turn.
// The error flag mirrors the runtime's onError hook: an errored turn must read
// as unproductive even when warning text was mirrored into the reply.
export interface ObservedReply {
  text: string;
  errored: boolean;
}

const observedReplies = new Map<string, ObservedReply>();

/** Starts collecting deltas for one automation message id (resets any stale entry). */
export function beginObservedReply(messageId: string): void {
  observedReplies.set(messageId, { text: "", errored: false });
}

/** Appends one delta; a no-op for ids that were never begun (or already ended). */
export function appendObservedReplyDelta(messageId: string, delta: string): void {
  const reply = observedReplies.get(messageId);
  if (!reply) return;
  reply.text += delta;
}

/** Flags the turn as errored; a no-op for ids that were never begun (or already ended). */
export function markObservedReplyError(messageId: string): void {
  const reply = observedReplies.get(messageId);
  if (!reply) return;
  reply.errored = true;
}

/** Ends collection and returns the reply with its error flag (empty/never-errored for unknown ids). */
export function endObservedReply(messageId: string): ObservedReply {
  const reply = observedReplies.get(messageId) ?? { text: "", errored: false };
  observedReplies.delete(messageId);
  return reply;
}
