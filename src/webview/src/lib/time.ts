/** 时间工具：相对时间（侧栏会话行）、思考时长短描述、问候分档。 */

export function relativeTime(timestamp: number, now = Date.now()): string {
  const minutes = Math.max(0, Math.floor((now - timestamp) / 60_000));
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes}分`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours}时` : `${Math.floor(hours / 24)}天`;
}

/** 思考行的「持续了几秒/十几秒」式短描述。 */
export function formatThinkingDuration(durationMs: number): string {
  const seconds = Math.max(0, Math.round(durationMs / 1000));
  if (seconds < 3) return "了几秒";
  if (seconds < 10) return "了几秒";
  if (seconds < 60) return `了 ${seconds} 秒`;
  return `了 ${Math.floor(seconds / 60)} 分 ${String(seconds % 60).padStart(2, "0")} 秒`;
}

/** 落地页问候语按本地小时分档（参考的分档边界 [5,9,12,14,18,23]），返回 i18n 键。 */
export function greetingKeyForHour(hour: number): string {
  if (hour >= 5 && hour < 9) return "chat.greeting.morningEarly";
  if (hour >= 9 && hour < 12) return "chat.greeting.morning";
  if (hour >= 12 && hour < 14) return "chat.greeting.noon";
  if (hour >= 14 && hour < 18) return "chat.greeting.afternoon";
  if (hour >= 18 && hour < 23) return "chat.greeting.evening";
  return "chat.greeting.lateNight";
}
