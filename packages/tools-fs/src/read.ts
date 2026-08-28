import fs from "node:fs/promises";
import { resolveWithin, requireString, workspaceScope } from "./paths";
import type { Tool, ToolContext } from "@innocenceharness/harness-tools";

const MAX_LINES = 2000;
/** 大文件提示阈值：总行数超过两页上限且从第 1 行起读取时附分块建议。 */
const LARGE_FILE_LINES = 2 * MAX_LINES;

/** Read a text file with `cat -n` style line numbers (offset/limit paging). */
export const readTool: Tool = {
  name: "Read",
  description:
    "读取工作区内的文本文件，返回带行号的内容。用 offset/limit 分页，默认最多 " +
    `${MAX_LINES} 行。引用代码时请使用 文件路径:行号 格式。`,
  readOnly: true,
  sideEffect: "none",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "工作区相对路径或绝对路径" },
      offset: { type: "integer", description: "起始行（1 起），可选" },
      limit: { type: "integer", description: "读取行数，可选" },
    },
    required: ["path"],
  },
  async validateArgs(args) {
    requireString(args, "path");
  },
  permissionResource(args, ctx: ToolContext) {
    return {
      action: "read",
      kind: "path",
      scope: workspaceScope(ctx.workspaceRoot, requireString(args, "path")),
    };
  },
  // 读取参数不含机密值；路径/分页原样持久化以供规则匹配与后续对话理解。
  persistArgs(args) {
    return { path: args.path, offset: args.offset, limit: args.limit };
  },
  async execute(args, ctx: ToolContext) {
    const target = resolveWithin(ctx.workspaceRoot, requireString(args, "path"));
    const stat = await fs.stat(target);
    if (stat.isDirectory()) throw new Error(`是目录不是文件：${target}`);
    const raw = await fs.readFile(target, "utf8");
    // 空文件（0 字节）单独注记：区别于 offset 越界，并引导用写入工具建立内容。
    if (raw.length === 0) {
      return {
        content: "[空文件：文件存在但内容为空（0 字节），可能是占位或异常产物；需要内容时请用写入工具建立]",
      };
    }
    const allLines = raw.split("\n");
    const offset = Math.max(1, Number(args.offset) || 1);
    const limit = Math.min(Number(args.limit) || MAX_LINES, MAX_LINES);
    // offset 超出末行时 slice 为空，必须显式说明，不能误报为空文件。
    if (offset > allLines.length) {
      return {
        content:
          `[起始行越界：文件共 ${allLines.length} 行，offset=${offset} 已超出末行，` +
          "无需继续读取；这不是空文件]",
      };
    }
    const slice = allLines.slice(offset - 1, offset - 1 + limit);
    const body = slice.map((line, i) => `${offset + i}\t${line}`).join("\n");
    const notes: string[] = [];
    if (offset - 1 + limit < allLines.length) {
      notes.push(
        `[已截断：共 ${allLines.length} 行，本次 limit=${limit} 生效；` +
          `请用 offset=${offset + limit} 顺序续读，勿重读全文或来回跳页]`,
      );
    }
    if (offset === 1 && allLines.length > LARGE_FILE_LINES) {
      notes.push("[大文件提示：如需完整内容请分块顺序读取，引用格式保持 文件路径:行号]");
    }
    return { content: notes.length > 0 ? `${body}\n${notes.join("\n")}` : body };
  },
};
