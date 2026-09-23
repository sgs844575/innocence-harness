import type { Tool } from "@innocenceharness/harness-tools";
import { creationDocs } from "./creationDocs";

/**
 * creation_docs：读取随应用打包的各插件类型创建格式与帮助文档。省略
 * type 返回全部类型与一行摘要（供模型先浏览再选读）；给定 type 返回该
 * 类型全文。纯只读（文档编译进插件，无 IO），创建模式工作流要求在
 * 设计/脚手架之前先读所选类型的文档。
 */
export function createCreationDocsTool(): Tool {
  const types = creationDocs.map((doc) => doc.type);
  return {
    name: "creation_docs",
    description:
      "Read the bundled creation-format help docs for each plugin type " +
      "(tool, skill, agent-mode, message-processor, provider, overview). " +
      "Call without type to list every doc with a one-line summary; call " +
      "with type to read the full format. Read the chosen type BEFORE " +
      "designing or scaffolding a plugin.",
    readOnly: true,
    sideEffect: "none",
    parameters: {
      type: "object",
      properties: {
        type: {
          type: "string",
          enum: types,
          description: "Plugin type to read; omit to list all types with summaries",
        },
      },
      required: [],
    },
    validateArgs(args) {
      if (args.type !== undefined && !types.includes(args.type as string)) {
        throw new Error(`未知文档类型：${String(args.type)}（可用：${types.join(", ")}）`);
      }
    },
    permissionResource() {
      return { action: "read", kind: "plugin", scope: "creation-docs" };
    },
    async execute(args) {
      if (args.type === undefined) {
        const listing = creationDocs
          .map((doc) => `- ${doc.type}: ${doc.summary}`)
          .join("\n");
        return {
          content: `Bundled creation docs (call again with type for the full format):\n${listing}`,
        };
      }
      const doc = creationDocs.find((entry) => entry.type === args.type);
      if (!doc) {
        return { content: `未知文档类型：${String(args.type)}（可用：${types.join(", ")}）`, isError: true };
      }
      return { content: doc.body };
    },
  };
}
