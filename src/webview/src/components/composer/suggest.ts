// 输入卡 @ 文件 / / 技能补全的纯逻辑面：光标 token 检测（与运行时展开语义
// 对齐——/ 调用形必须是消息首词）、目录过滤排序、采纳替换。无 React/IO。

/** 补全 token：kind 决定数据源；[start, end) 是 textarea 值内待替换片段
 *  （含前导符），query 为已输入过滤词（不含前导符）。 */
export interface SuggestToken {
  kind: "slash" | "at";
  start: number;
  end: number;
  query: string;
}

/** 词分隔 = 空白（路径/命令名内的 / . - _ 等都算词内字符）。 */
function isWordSep(ch: string): boolean {
  return /\s/.test(ch);
}

/**
 * 检测光标处的补全 token。
 * slash：消息以 "/" 开头（允许前导空白——运行时对 text.trim() 匹配调用形）
 * 且光标仍在首词内；越过空白即视为完形收起。at：包含光标的非空白词以 "@"
 * 起头即触发（文本任意位置；"a@b" 的词首不是 @，不触发）。
 */
export function detectSuggestToken(value: string, caret: number): SuggestToken | null {
  // slash：与 plugin-skills 的 /^\/name\s*/ 调用形对齐（仅消息首词）。
  const lead = value.length - value.trimStart().length;
  if (value[lead] === "/") {
    let end = lead + 1;
    while (end < value.length && !isWordSep(value[end]!)) end += 1;
    if (caret > lead && caret <= end) {
      return { kind: "slash", start: lead, end, query: value.slice(lead + 1, caret) };
    }
  }
  // at：向两侧扩到空白得当前词，词首必须是 "@"。
  let start = caret;
  while (start > 0 && !isWordSep(value[start - 1]!)) start -= 1;
  let end = caret;
  while (end < value.length && !isWordSep(value[end]!)) end += 1;
  if (value[start] === "@" && caret > start && caret <= end) {
    return { kind: "at", start, end, query: value.slice(start + 1, caret) };
  }
  return null;
}

/** 渲染行数上限（数据集全量过滤，只封顶渲染）。 */
export const SUGGEST_MAX_ROWS = 50;

/** 技能过滤排序：名前缀 > 名包含 > 描述包含；平局按名稳定排序。 */
export function filterSkillItems(
  catalog: readonly { name: string; description: string }[],
  query: string,
): { name: string; description: string }[] {
  const q = query.trim().toLowerCase();
  return catalog
    .map((skill, index) => {
      const name = skill.name.toLowerCase();
      const rank = q === ""
        ? 3
        : name.startsWith(q)
          ? 3
          : name.includes(q)
            ? 2
            : skill.description.toLowerCase().includes(q)
              ? 1
              : 0;
      return { skill, index, rank };
    })
    .filter((entry) => entry.rank > 0)
    .sort((a, b) => b.rank - a.rank || a.skill.name.localeCompare(b.skill.name) || a.index - b.index)
    .slice(0, SUGGEST_MAX_ROWS)
    .map((entry) => entry.skill);
}

/** 文件过滤排序：文件名前缀 > 文件名包含 > 路径包含；平局短路径优先。 */
export function filterFileItems(
  paths: readonly string[],
  query: string,
): { path: string; dir: string; name: string }[] {
  const q = query.trim().toLowerCase();
  return paths
    .map((path) => {
      const slash = path.lastIndexOf("/");
      const name = slash === -1 ? path : path.slice(slash + 1);
      const dir = slash === -1 ? "" : path.slice(0, slash + 1);
      const lowerName = name.toLowerCase();
      const rank = q === ""
        ? 3
        : lowerName.startsWith(q)
          ? 3
          : lowerName.includes(q)
            ? 2
            : path.toLowerCase().includes(q)
              ? 1
              : 0;
      return { path, dir, name, rank };
    })
    .filter((entry) => entry.rank > 0)
    .sort((a, b) => b.rank - a.rank || a.path.length - b.path.length || a.path.localeCompare(b.path))
    .slice(0, SUGGEST_MAX_ROWS);
}

/** 采纳替换：token 片段整体换成 insert（"/name " / "@rel/path "，带尾空格），
 *  光标落插入末尾。 */
export function applySuggestion(
  value: string,
  token: SuggestToken,
  insert: string,
): { value: string; caret: number } {
  return {
    value: value.slice(0, token.start) + insert + value.slice(token.end),
    caret: token.start + insert.length,
  };
}
