import fs from "node:fs/promises";
import path from "node:path";
import type { Context } from "@innocenceharness/kernel";
import { type Tool, type ToolContext } from "@innocenceharness/harness-tools";
import { resolveWithin } from "@innocenceharness/tools-fs";
import {
  createZipArchive,
  encryptArchive,
  type ArchiveEntry,
} from "./archive";

const MAX_ENTRIES = 500;
const MAX_TOTAL_BYTES = 64 * 1024 * 1024;

function requireStringArray(args: Record<string, unknown>, key: string): string[] {
  const value = args[key];
  if (!Array.isArray(value) || value.length === 0 || !value.every((v) => typeof v === "string" && v.length > 0)) {
    throw new Error(`缺少必填参数 ${key}（非空字符串数组）`);
  }
  return value as string[];
}

/** Archive tool: bundles workspace files into a (optionally encrypted) zip. */
export const archiveTool: Tool = {
  name: "make_archive",
  description:
    "把工作区内的一组文件打包成 zip 归档（可选口令加密），用于交付日志、产物或快照。" +
    "路径必须位于工作区内；条目数量与总体积有上限。",
  readOnly: false,
  sideEffect: "paths",
  parameters: {
    type: "object",
    properties: {
      paths: { type: "array", items: { type: "string" }, description: "工作区内相对路径列表" },
      output: { type: "string", description: "归档输出路径（工作区内相对路径，建议 .zip 结尾）" },
      passphrase: { type: "string", description: "加密口令（可选；提供则输出加密归档）" },
    },
    required: ["paths", "output"],
  },
  validateArgs(args) {
    requireStringArray(args, "paths");
    if (typeof args.output !== "string" || args.output.trim().length === 0) {
      throw new Error("缺少必填参数 output（字符串）");
    }
    if (args.passphrase !== undefined && (typeof args.passphrase !== "string" || args.passphrase.length === 0)) {
      throw new Error("passphrase 必须是非空字符串");
    }
  },
  permissionResource(args) {
    return {
      action: "write",
      kind: "fs",
      scope: String(args.output ?? ""),
    };
  },
  persistArgs(args) {
    const paths = Array.isArray(args.paths) ? args.paths.map((p) => String(p)) : [];
    // 持久化完整原文供展示与留档；口令属声明式凭据字段，仅以 encrypted 布尔留痕、不落盘。
    return {
      output: String(args.output ?? ""),
      paths,
      encrypted: args.passphrase !== undefined,
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

    let archive = await createZipArchive(entries);
    const passphrase = typeof args.passphrase === "string" ? args.passphrase : undefined;
    if (passphrase !== undefined) {
      archive = encryptArchive(archive, passphrase);
    }

    const outputAbs = resolveWithin(root, outputRel);
    await fs.mkdir(path.dirname(outputAbs), { recursive: true });
    await fs.writeFile(outputAbs, archive);
    return {
      content: `已写入 ${outputRel}：${entries.length} 个条目，${archive.length} 字节${passphrase !== undefined ? "（已加密）" : ""}`,
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
