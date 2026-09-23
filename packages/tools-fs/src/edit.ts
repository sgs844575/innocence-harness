import fs from "node:fs/promises";
import { resolveWithin, requireString, workspaceScope } from "./paths";
import {
  detectLineEndings,
  findEditMatch,
  normalizeLineEndings,
  normalizeReplacementForMatch,
  preserveQuoteStyle,
} from "./edit-matchers";
import { readContextKey, type ReadFileRegistry } from "./read-state";
import type { Tool, ToolContext } from "@innocenceharness/harness-tools";

/** Exact-string replacement with tolerance matching: matching happens on the
 *  LF-normalized text (CRLF never breaks old_string), a strategy chain
 *  absorbs the usual copy artifacts (Read line-number prefixes, literal
 *  escapes, curly quotes, indentation drift), and the file's dominant line
 *  ending style is preserved on write-back. The session's read-state
 *  registry (same instance the Read tool records into) lets a not-found
 *  failure say the truth: when the file changed on disk since the model's
 *  last read, the stale read is the diagnosis — not imaginary whitespace. */
export function createEditTool(registry?: ReadFileRegistry): Tool {
  return {
    name: "Edit",
    description:
      "对文件做精确字符串替换（行尾风格不敏感：CRLF/LF 自动归一匹配并按原文件风格写回；" +
      "缩进/行号前缀/转义等常见拷贝差异可宽容匹配）。old_string 定位的原文须唯一，" +
      "否则报错；多处替换需传 replace_all。修改前建议先 Read 确认原文。",
    readOnly: false,
    sideEffect: "paths",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "工作区相对路径或绝对路径" },
        old_string: { type: "string", description: "要替换的原文（含缩进，须唯一）" },
        new_string: { type: "string", description: "替换后的文本" },
        replace_all: { type: "boolean", description: "替换所有出现处，默认 false" },
      },
      required: ["path", "old_string", "new_string"],
    },
    async validateArgs(args) {
      requireString(args, "path");
      requireString(args, "old_string");
      requireString(args, "new_string");
    },
    permissionResource(args, ctx: ToolContext) {
      return {
        action: "write",
        kind: "path",
        scope: workspaceScope(ctx.workspaceRoot, requireString(args, "path")),
      };
    },
    async execute(args, ctx: ToolContext) {
      const target = resolveWithin(ctx.workspaceRoot, requireString(args, "path"));
      const oldString = normalizeLineEndings(requireString(args, "old_string"));
      const requestedNewString = normalizeLineEndings(requireString(args, "new_string"));
      const replaceAll = args.replace_all === true;
      // 失败走 isError 结果而非抛出：loop 的 catch 兜底只保留通用文案，
      // 具体原因必须随结果文本进历史与聊天工具行。内容失配类失败必须
      // 引导模型先读原文再重试（带定位），而不是凭记忆盲改。
      const failure = (content: string) => ({ content, isError: true });
      const errText = (err: unknown) => (err instanceof Error ? err.message : String(err));
      const displayPath = requireString(args, "path");

      let raw: string;
      try {
        raw = await fs.readFile(target, "utf8");
      } catch (err) {
        return failure(`读取文件失败：${errText(err)}；请先 Read 确认路径与文件状态`);
      }
      // 匹配域：LF 归一（行数不变，行号与原文件一致）；写回按原文行尾风格还原。
      const lineEndings = detectLineEndings(raw);
      const content = normalizeLineEndings(raw);

      const match = findEditMatch({ content, search: oldString, replaceAll });
      if (match.status === "not_found") {
        // 过期读取优先诊断：文件在本会话上次读取后已被外部改动（并行会话/
        // 外部编辑器）时，模型手里的原文大概率整体过期——先告知重读基于
        // 当前内容重写编辑，而不是误导去核对并不存在的“缩进差异”。
        if (await staleSinceLastRead(target, ctx, registry)) {
          return failure(
            `old_string 未找到，且磁盘文件在你本会话上次读取之后已被修改（大小或修改时间不同）——` +
              `你依据的原文已过期，重试同样的摘录不会成功。` +
              `请重新 Read ${displayPath} 定位目标区段，基于当前内容重新给出 old_string 与 new_string。`,
          );
        }
        const near = nearestOccurrenceLine(content, oldString);
        if (near !== null) {
          const offset = Math.max(1, near - 5);
          return failure(
            `old_string 未找到，但第 ${near} 行附近有相似内容（缩进/空白可能不同）。` +
              `请先 Read ${displayPath}（offset=${offset}, limit=20）核对当前原文，再用精确原文重试；不要凭记忆连续重试。`,
          );
        }
        return failure(
          `old_string 未找到。请先 Read ${displayPath} 核对当前原文（含缩进与空行）后再重试；不要凭记忆连续重试。`,
        );
      }
      if (match.status === "ambiguous") {
        // 策略链命中多个不同候选：无法唯一定位，不猜。
        return failure(
          `old_string 经宽容匹配（${match.strategy}）命中 ${match.candidateCount} 个不同候选，无法唯一定位。` +
            `请先 Read ${displayPath} 核对原文，补充更多上下文使其唯一后重试。`,
        );
      }
      const actualOldString = match.actualString;

      const count = content.split(actualOldString).length - 1;
      if (count > 1 && !replaceAll) {
        const lines = occurrenceLines(content, actualOldString).join(", ");
        return failure(
          `old_string 出现 ${count} 次（第 ${lines} 行）。请先 Read 对应区段，补充上下文使其唯一后重试；` +
            `确认要整体替换时才传 replace_all: true。`,
        );
      }

      const normalizedNewString = normalizeReplacementForMatch(match.strategy, requestedNewString);
      const actualNewString = preserveQuoteStyle(oldString, actualOldString, normalizedNewString);
      const normalizedNext = applyEditToContent(content, actualOldString, actualNewString, replaceAll);
      const next = lineEndings === "CRLF" ? normalizedNext.replaceAll("\n", "\r\n") : normalizedNext;
      try {
        await fs.writeFile(target, next, "utf8");
      } catch (err) {
        return failure(`写入文件失败：${errText(err)}`);
      }
      return {
        content: `已替换 ${replaceAll ? count : 1} 处：${displayPath}${lineEndings === "CRLF" ? "（保持 CRLF 行尾）" : ""}`,
      };
    },
  };
}

/** 归一域替换：空 new_string 删除时对结尾换行宽容；字面替换防 $ 特殊 token。 */
function applyEditToContent(
  content: string,
  oldString: string,
  newString: string,
  replaceAll: boolean,
): string {
  if (newString !== "") {
    return replaceLiteral(content, oldString, newString, replaceAll);
  }

  const search =
    !oldString.endsWith("\n") && content.includes(`${oldString}\n`) ? `${oldString}\n` : oldString;

  return replaceLiteral(content, search, newString, replaceAll);
}

/** 字符串 replacement 会把 $$/$& 当特殊 token，用函数形式绕开。 */
function replaceLiteral(
  content: string,
  search: string,
  replacement: string,
  replaceAll: boolean,
): string {
  return replaceAll
    ? content.replaceAll(search, () => replacement)
    : content.replace(search, () => replacement);
}

/** 1-based 行号数组：needle 在 haystack 中的每次出现所在行。 */
function occurrenceLines(haystack: string, needle: string): number[] {
  const lines: number[] = [];
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    lines.push(haystack.slice(0, index).split("\n").length);
    index = haystack.indexOf(needle, index + 1);
  }
  return lines;
}

/**
 * 未精确命中时的相似区段探测（失败结果的定位兜底）：先做空白归一（所有
 * 空白串折成单空格）的整体包含查找（最能代表目标区段），再退到
 * old_string 首个非空行的整行精确查找。返回 1-based 行号；无可信相似
 * 内容时返回 null。
 */
function nearestOccurrenceLine(haystack: string, oldString: string): number | null {
  const lines = haystack.split("\n");
  const collapsedStarts: number[] = [];
  let collapsed = "";
  for (const line of lines) {
    collapsedStarts.push(collapsed.length);
    const piece = line.trim();
    if (piece !== "") collapsed += (collapsed === "" ? "" : " ") + piece;
  }
  const needle = collapseWhitespace(oldString);
  if (needle !== "") {
    const at = collapsed.indexOf(needle);
    if (at !== -1) {
      for (let i = 0; i < lines.length; i += 1) {
        const start = collapsedStarts[i]!;
        const end = i + 1 < lines.length ? collapsedStarts[i + 1]! : collapsed.length + 1;
        if (at >= start && at < end) return i + 1;
      }
    }
  }
  const firstLine = oldString.split("\n").find((line) => line.trim() !== "");
  if (firstLine !== undefined) {
    const index = haystack.indexOf(firstLine);
    if (index !== -1) {
      return haystack.slice(0, index).split("\n").length;
    }
  }
  return null;
}

/** 折叠全部空白串为单个空格（两端去空）。 */
function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/** Zero-config Edit tool（默认：persisted args 正文全量保留）。 */
export const editTool: Tool = createEditTool();

/**
 * 过期读取判定：本会话上下文读过此文件、且当前磁盘签名与上次读取记录不同
 * （mtime 或 size 变化）→ true。注册表缺省（zero-config 实例）或无读取
 * 记录时不判定，走既有失败文案。
 */
async function staleSinceLastRead(
  target: string,
  ctx: ToolContext,
  registry: ReadFileRegistry | undefined,
): Promise<boolean> {
  if (!registry) return false;
  const previous = registry.lookup(target, readContextKey(ctx.scope));
  if (!previous) return false;
  try {
    const stat = await fs.stat(target);
    return stat.mtimeMs !== previous.signature.mtimeMs || stat.size !== previous.signature.size;
  } catch {
    return false;
  }
}
