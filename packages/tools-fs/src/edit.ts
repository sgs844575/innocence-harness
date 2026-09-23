import fs from "node:fs/promises";
import { resolveWithin, requireString, workspaceScope } from "./paths";
import type { Tool, ToolContext } from "@innocenceharness/harness-tools";

/** Exact-string replacement with uniqueness enforcement. */
export function createEditTool(): Tool {
  return {
    name: "Edit",
    description:
      "对文件做精确字符串替换。old_string 必须在文件中唯一，否则报错；" +
      "多处替换需传 replace_all。修改前建议先 Read 确认原文。",
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
      const oldString = requireString(args, "old_string");
      const newString = requireString(args, "new_string");
      const replaceAll = args.replace_all === true;
      // 失败走 isError 结果而非抛出：loop 的 catch 兜底只保留通用文案，
      // 具体原因必须随结果文本进历史与聊天工具行。内容失配类失败必须
      // 引导模型先读原文再重试（带定位），而不是凭记忆盲改。
      const failure = (content: string) => ({ content, isError: true });
      const errText = (err: unknown) => (err instanceof Error ? err.message : String(err));
      const displayPath = requireString(args, "path");

      let current: string;
      try {
        current = await fs.readFile(target, "utf8");
      } catch (err) {
        return failure(`读取文件失败：${errText(err)}；请先 Read 确认路径与文件状态`);
      }
      const count = current.split(oldString).length - 1;
      if (count === 0) {
        const near = nearestOccurrenceLine(current, oldString);
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
      if (count > 1 && !replaceAll) {
        const lines = occurrenceLines(current, oldString).join(", ");
        return failure(
          `old_string 出现 ${count} 次（第 ${lines} 行）。请先 Read 对应区段，补充上下文使其唯一后重试；` +
            `确认要整体替换时才传 replace_all: true。`,
        );
      }

      const next = replaceAll
        ? current.split(oldString).join(newString)
        : current.replace(oldString, newString);
      try {
        await fs.writeFile(target, next, "utf8");
      } catch (err) {
        return failure(`写入文件失败：${errText(err)}`);
      }
      return {
        content: `已替换 ${replaceAll ? count : 1} 处：${displayPath}`,
      };
    },
  };
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
 * 未精确命中时的相似区段探测：先做空白归一（所有空白串折成单空格）的
 * 整体包含查找（最能代表目标区段），再退到 old_string 首个非空行的整行
 * 精确查找。返回 1-based 行号；无可信相似内容时返回 null。
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
