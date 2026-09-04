import fs from "node:fs/promises";
import path from "node:path";
import type { Context } from "@innocenceharness/kernel";
import { type Tool, type ToolContext } from "@innocenceharness/harness-tools";
import { resolveWithin } from "@innocenceharness/tools-fs";
import { createZipArchive, type ArchiveEntry } from "./archive";

const MAX_ENTRIES = 500;
const MAX_TOTAL_BYTES = 64 * 1024 * 1024;

function requireStringArray(args: Record<string, unknown>, key: string): string[] {
  const value = args[key];
  if (!Array.isArray(value) || value.length === 0 || !value.every((v) => typeof v === "string" && v.length > 0)) {
    throw new Error(`缺少必填参数 ${key}（非空字符串数组）`);
  }
  return value as string[];
}

/** Archive tool: bundles workspace files into a zip. */
export const archiveTool: Tool = {
  name: "make_archive",
  description:
    "把工作区内的一组文件打包成 zip 归档，用于交付日志、产物或快照。" +
    "路径必须位于工作区内；条目数量与总体积有上限。",
  readOnly: false,
  sideEffect: "paths",
  parameters: {
    type: "object",
    properties: {
      paths: { type: "array", items: { type: "string" }, description: "工作区内相对路径列表" },
      output: { type: "string", description: "归档输出路径（工作区内相对路径，建议 .zip 结尾）" },
    },
    required: ["paths", "output"],
  },
  validateArgs(args) {
    requireStringArray(args, "paths");
    if (typeof args.output !== "string" || args.output.trim().length === 0) {
      throw new Error("缺少必填参数 output（字符串）");
    }
  },
  permissionResource(args) {
    return {
      action: "write",
      kind: "fs",
      scope: String(args.output ?? ""),
    };
  },
  async execute(args, ctx: ToolContext) {
    const root = ctx.workspaceRoot;
    const rawPaths = requireStringArray(args, "paths");
    if (rawPaths.length > MAX_ENTRIES) throw new Error(`条目过多（>${MAX_ENTRIES}）`);
    const outputRel = String(args.output);

    const entries: ArchiveEntry[] = [];
    let total = 0;
    for (const rel of rawPaths) {
      const abs = resolveWithin(root, rel);
      const stat = await fs.stat(abs);
      if (!stat.isFile()) throw new Error(`不是文件：${rel}`);
      total += stat.size;
      if (total > MAX_TOTAL_BYTES) throw new Error(`总体积超限（>${MAX_TOTAL_BYTES} 字节）`);
      const data = await fs.readFile(abs);
      entries.push({ name: rel.split(path.sep).join("/"), data });
    }

    const archive = await createZipArchive(entries);
    const outputAbs = resolveWithin(root, outputRel);
    await fs.mkdir(path.dirname(outputAbs), { recursive: true });
    await fs.writeFile(outputAbs, archive);
    return {
      content: `已写入 ${outputRel}：${entries.length} 个条目，${archive.length} 字节`,
      isError: false,
    };
  },
};

/** Archive tools plugin — registers the make_archive tool. */
export const ArchivePlugin = {
  name: "archive",
  apply(ctx: Context) {
    ctx.tools.register(archiveTool);
  },
};
export default ArchivePlugin;
