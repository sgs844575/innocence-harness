// 持久化正文的有界剪裁。Edit/Write 的正文（用户裁定进入 persisted args 供
// 聊天工具行展示 diff）不能无限占满历史/审计/转录——超长内容在这里截到封顶，
// 并留下明确的截断标记，防止 UI 和压缩摘要被巨型正文淹没。
export const PERSIST_TEXT_CHAR_LIMIT = 12_000;
export const SUMMARY_CHAR_LIMIT = 400;

export interface BoundedText {
  text: string;
  truncated: boolean;
}

/** 截到 `limit` 字符（含一个省略号标记），短文本原样返回。 */
export function boundPersistedText(text: string, limit: number): BoundedText {
  if (text.length <= limit) return { text, truncated: false };
  return { text: `${text.slice(0, limit - 1)}…`, truncated: true };
}

/**
 * 单行摘要：把行折叠成 ` | ` 分隔的一段；超过封顶字符时整段降级为省略号
 * （巨块无法提炼，直接标记“内容过大”比截断前缀更诚实）。
 */
export function summaryOfLines(lines: readonly string[]): string {
  const joined = lines.filter((line) => line !== "").join(" | ");
  if (joined.length > SUMMARY_CHAR_LIMIT) return "…";
  return joined;
}