// 审查面板的 Git 工作区查询：改动文件列表（numstat + 未跟踪补充）与单文件
// unified diff 文本。全部走只读 git 命令（-c core.quotepath=false 保中文路径），
// 绝不触碰用户 index（未跟踪文件的 diff 用读文件兜底，不用 git add -N）。
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { ReviewFileDiffResult, ReviewFileEntry, ReviewScope } from "../shared/ipc";

const execFileAsync = promisify(execFile);

/** 单文件 diff 文本上限（防御截断；超出部分不展示）。 */
const MAX_PATCH_CHARS = 400_000;
/** 未跟踪文件读取上限。 */
const MAX_UNTRACKED_CHARS = 256_000;

async function git(root: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", ["-c", "core.quotepath=false", "-C", root, ...args], {
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024,
  });
  return stdout;
}

async function isGitRepo(root: string): Promise<boolean> {
  try {
    await git(root, ["rev-parse", "--is-inside-work-tree"]);
    return true;
  } catch {
    return false;
  }
}

/** numstat 行：`add\tdel\tpath`（二进制为 `-`）；重命名显示原样的 {old => new}。 */
function parseNumstat(text: string): ReviewFileEntry[] {
  const files: ReviewFileEntry[] = [];
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    const parts = line.split("\t");
    if (parts.length < 3) continue;
    const [add, del, ...rest] = parts;
    files.push({
      path: rest.join("\t"),
      additions: add === "-" ? 0 : Number(add) || 0,
      deletions: del === "-" ? 0 : Number(del) || 0,
    });
  }
  return files;
}

/** 未跟踪文件（porcelain -z 的 `??` 条目；目录条目跳过——v1 不展开目录）。 */
async function untrackedFiles(root: string): Promise<ReviewFileEntry[]> {
  const status = await git(root, ["status", "--porcelain", "-z"]);
  const entries = status.split("\0").filter((entry) => entry.startsWith("?? "));
  const files: ReviewFileEntry[] = [];
  for (const entry of entries) {
    const relPath = entry.slice(3);
    if (relPath.endsWith("/")) continue; // 整目录未跟踪：v1 不展开
    let additions = 0;
    try {
      const buffer = await fs.readFile(path.join(root, relPath));
      const text = buffer.subarray(0, MAX_UNTRACKED_CHARS).toString("utf8");
      // 含 NUL 视为二进制：不计行数（列表显示 +0）。
      if (!text.includes(String.fromCharCode(0))) additions = text.length === 0 ? 0 : text.split("\n").length - (text.endsWith("\n") ? 1 : 0);
    } catch {
      // 读不到（权限/竞态删除）：按 0 行计入列表。
    }
    files.push({ path: relPath, additions, deletions: 0, untracked: true });
  }
  return files;
}

/** 审查面板文件列表；非 Git 仓库 → null（面板空态）。 */
export async function workspaceReviewFiles(
  root: string,
  scope: ReviewScope,
): Promise<{ files: ReviewFileEntry[] } | null> {
  if (!(await isGitRepo(root))) return null;
  try {
    const numstat = await git(root, scope === "staged" ? ["diff", "--cached", "--numstat"] : ["diff", "--numstat"]);
    const files = parseNumstat(numstat);
    if (scope === "unstaged") files.push(...(await untrackedFiles(root)));
    return { files };
  } catch {
    return null;
  }
}

/** 渲染端路径防越界：只接受仓库相对路径。 */
function sanitizeRelPath(relPath: string): string | null {
  const normalized = path.normalize(relPath);
  if (path.isAbsolute(relPath) || normalized === ".." || normalized.startsWith(`..${path.sep}`)) return null;
  return normalized;
}

/** 单文件 diff；未跟踪文件返回全文（kind: "untracked"），非仓库/失败 → null。 */
export async function workspaceReviewFileDiff(
  root: string,
  scope: ReviewScope,
  relPath: string,
): Promise<ReviewFileDiffResult> {
  const safe = sanitizeRelPath(relPath);
  if (safe === null || !(await isGitRepo(root))) return null;
  try {
    // 未跟踪文件（未被 index 认识）没有 git diff：读工作区全文按全新增展示。
    let tracked = true;
    try {
      await git(root, ["ls-files", "--error-unmatch", "--", safe]);
    } catch {
      tracked = false;
    }
    if (!tracked) {
      if (scope === "staged") return null;
      const buffer = await fs.readFile(path.join(root, safe));
      const text = buffer.subarray(0, MAX_UNTRACKED_CHARS).toString("utf8");
      return { kind: "untracked", text };
    }
    const args = scope === "staged" ? ["diff", "--cached", "--", safe] : ["diff", "--", safe];
    const patch = (await git(root, args)).slice(0, MAX_PATCH_CHARS);
    return { kind: "patch", patch };
  } catch {
    return null;
  }
}
