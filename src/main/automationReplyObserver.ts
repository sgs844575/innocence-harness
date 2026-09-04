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
  error?: string;
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
export function markObservedReplyError(messageId: string, error: string): void {
  const reply = observedReplies.get(messageId);
  if (!reply) return;
  reply.errored = true;
  reply.error = error;
}

/** Ends collection and returns the reply with its error flag (empty/never-errored for unknown ids). */
export function endObservedReply(messageId: string): ObservedReply {
  const reply = observedReplies.get(messageId) ?? { text: "", errored: false };
  observedReplies.delete(messageId);
  return reply;
}

/** 剥离宿主镜像的通知行（runtime-events 的告警/压缩提示）：它们不是 agent
 * 的自述文本，不得伪造非空回复或携带整行标记。行锚定匹配（trim 后以
 * "> ⚠️"/"> 🗜️" 开头的行整行移除），正文行原样保留——自动化循环派发与
 * 队友投递端口共用的同一定义。 */
export function ownReplyText(text: string): string {
  return text
    .split("\n")
    .filter((line) => !/^>\s*(⚠️|🗜️)/.test(line.trim()))
    .join("\n");
}
