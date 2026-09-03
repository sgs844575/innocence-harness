// 侧栏文件树的工作区文件面（无 electron 依赖，便于 Node 侧测试）：
// 单级目录列举（懒加载树）/ 受限文本读取 / 全量文件清单（搜索用）。
// 路径防护与 codeReader 同源：isSafeRelativePath + 逐段 symlink 拒绝。
import fs from "node:fs/promises";
import path from "node:path";
import { isSafeRelativePath } from "@innocenceharness/secure-storage-node";
import type { WorkspaceDirEntry, WorkspaceFileContent } from "../shared/ipc";

/** 遍历时跳过的重量级/内部目录。 */
const SKIP_DIRS = new Set([".git", "node_modules"]);
/** 全量清单上限：超大仓库搜索也不让主进程跑无界遍历。 */
export const MAX_WORKSPACE_LIST_FILES = 2000;
/** 读取上限：超过即截断（渲染层提示截断）。 */
export const MAX_WORKSPACE_READ_BYTES = 1_000_000;
/** NUL 探测窗口（git 二进制判定惯例）。 */
const BINARY_SNIFF_BYTES = 8000;

/** lstat 每一层路径段：任何一段是 symlink 即拒绝（防逃逸 root）。 */
async function assertNoSymlinkSegments(root: string, rel: string): Promise<void> {
  let current = root;
  for (const segment of rel.split("/").filter(Boolean)) {
    current = path.join(current, segment);
    const stat = await fs.lstat(current).catch(() => {
      throw new Error(`workspace files: path not found: ${rel}`);
    });
    if (stat.isSymbolicLink()) {
      throw new Error(`workspace files: path escapes workspace (symlink): ${rel}`);
    }
  }
}

function guardRel(root: string, rel: string): Promise<void> {
  if (rel !== "" && !isSafeRelativePath(rel)) {
    throw new Error(`workspace files: path outside workspace: ${JSON.stringify(rel)}`);
  }
  return assertNoSymlinkSegments(root, rel);
}

/** 单级目录列举：目录在前、文件随后，各自按名排序（大小写不敏感）。 */
export async function listWorkspaceDir(root: string, relDir: string): Promise<WorkspaceDirEntry[]> {
  await guardRel(root, relDir);
  const absolute = relDir === "" ? root : path.join(root, ...relDir.split("/"));
  const entries = await fs.readdir(absolute, { withFileTypes: true }).catch(() => {
    throw new Error(`workspace files: directory not found: ${relDir || "."}`);
  });
  return entries
    .filter((entry) => entry.isDirectory() || entry.isFile())
    .map((entry) => ({
      name: entry.name,
      rel: relDir === "" ? entry.name : `${relDir}/${entry.name}`,
      isDir: entry.isDirectory(),
    }))
    .sort((a, b) =>
      a.isDir === b.isDir
        ? a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
        : a.isDir
          ? -1
          : 1,
    );
}

/** 读取文本文件；二进制（NUL 嗅探）不回内容，超限截断。 */
export async function readWorkspaceFile(root: string, rel: string): Promise<WorkspaceFileContent> {
  await guardRel(root, rel);
  const absolute = path.join(root, ...rel.split("/"));
  const stat = await fs.stat(absolute).catch(() => {
    throw new Error(`workspace files: file not found: ${rel}`);
  });
  if (!stat.isFile()) throw new Error(`workspace files: not a regular file: ${rel}`);
  const buffer = await fs.readFile(absolute);
  const sniff = buffer.subarray(0, Math.min(buffer.length, BINARY_SNIFF_BYTES));
  if (sniff.includes(0)) return { content: "", truncated: false, binary: true };
  const truncated = buffer.length > MAX_WORKSPACE_READ_BYTES;
  const slice = truncated ? buffer.subarray(0, MAX_WORKSPACE_READ_BYTES) : buffer;
  return { content: new TextDecoder("utf-8", { fatal: false }).decode(slice), truncated, binary: false };
}

/** 全量文件清单（搜索用）：跳过 .git/node_modules，到达上限即停（排序后确定）。 */
export async function listWorkspaceFiles(root: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(rel: string): Promise<void> {
    if (out.length >= MAX_WORKSPACE_LIST_FILES) return;
    const absolute = rel === "" ? root : path.join(root, ...rel.split("/"));
    const entries = await fs.readdir(absolute, { withFileTypes: true }).catch(() => [] as import("node:fs").Dirent[]);
    for (const entry of entries) {
      if (out.length >= MAX_WORKSPACE_LIST_FILES) return;
      const childRel = rel === "" ? entry.name : `${rel}/${entry.name}`;
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) await walk(childRel);
      } else if (entry.isFile()) {
        out.push(childRel);
      }
    }
  }
  await walk("");
  return out.sort();
}
