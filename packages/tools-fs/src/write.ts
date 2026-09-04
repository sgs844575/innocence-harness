import fs from "node:fs/promises";
import path from "node:path";
import { resolveWithin, requireString, workspaceScope } from "./paths";
import type { Tool, ToolContext } from "@innocenceharness/harness-tools";

/** Create or overwrite a file (mkdir -p for parent directories). */
export function createWriteTool(): Tool {
  return {
    name: "Write",
    description:
      "创建或覆盖写入一个文本文件（整体覆盖，不是追加）。修改既有文件优先用 Edit。",
    readOnly: false,
    sideEffect: "paths",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "工作区相对路径或绝对路径" },
        content: { type: "string", description: "完整文件内容" },
      },
      required: ["path", "content"],
    },
    async validateArgs(args) {
      requireString(args, "path");
      requireString(args, "content");
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
      const content = requireString(args, "content");
      try {
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.writeFile(target, content, "utf8");
      } catch (err) {
        // 同 Edit：失败原因走 isError 结果返回，避免被 loop 兜底成通用文案。
        return {
          content: `写入文件失败：${err instanceof Error ? err.message : String(err)}`,
          isError: true,
        };
      }
      return { content: `已写入 ${path.relative(ctx.workspaceRoot, target) || target}（${content.length} 字符）` };
    },
  };
}

/** Zero-config Write tool（默认：persisted args 正文全量保留）。 */
export const writeTool: Tool = createWriteTool();
