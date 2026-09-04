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
      // 具体原因必须随结果文本进历史与聊天工具行。
      const failure = (content: string) => ({ content, isError: true });
      const errText = (err: unknown) => (err instanceof Error ? err.message : String(err));

      let current: string;
      try {
        current = await fs.readFile(target, "utf8");
      } catch (err) {
        return failure(`读取文件失败：${errText(err)}`);
      }
      const count = current.split(oldString).length - 1;
      if (count === 0) {
        return failure("old_string 在文件中不存在，请先 Read 确认原文（含缩进）");
      }
      if (count > 1 && !replaceAll) {
        return failure(`old_string 出现 ${count} 次，不唯一；请补充上下文使其唯一，或传 replace_all: true`);
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
        content: `已替换 ${replaceAll ? count : 1} 处：${requireString(args, "path")}`,
      };
    },
  };
}

/** Zero-config Edit tool（默认：persisted args 正文全量保留）。 */
export const editTool: Tool = createEditTool();
