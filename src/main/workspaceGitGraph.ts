// Git 图谱对话框的数据加载：全分支拓扑序提交列表（git log --all），纯只读
// 命令。字段解析（parseGitLog）与引用分类（parseRefKinds）独立可测；
// 非仓库 → null，空仓 → 空提交列表。
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { GitGraphCommit, GitGraphData, GitGraphRef } from "../shared/ipc";

const execFileAsync = promisify(execFile);

/** 提交数上限（多取 1 条探测截断）。 */
const MAX_COMMITS = 400;
const FIELD_SEP = "\x1f";

async function git(root: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", ["-c", "core.quotepath=false", "-C", root, ...args], {
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024,
  });
  return stdout;
}

/** 全引用名 → 徽标类别（heads 优先于 tags 优先于 remotes，重名不覆盖）。 */
export function parseRefKinds(text: string): Map<string, GitGraphRef["kind"]> {
  const kinds = new Map<string, GitGraphRef["kind"]>();
  const prefixes: [string, GitGraphRef["kind"]][] = [
    ["refs/heads/", "branch"],
    ["refs/tags/", "tag"],
    ["refs/remotes/", "remote"],
  ];
  for (const [prefix, kind] of prefixes) {
    for (const line of text.split("\n")) {
      const ref = line.trim();
      if (ref.startsWith(prefix) && !kinds.has(ref.slice(prefix.length))) {
        kinds.set(ref.slice(prefix.length), kind);
      }
    }
  }
  return kinds;
}

/** %D 装饰串 → 引用徽标（跳过裸 HEAD；HEAD -> x 取目标分支名）。 */
function parseDecorations(text: string, kinds: Map<string, GitGraphRef["kind"]>): GitGraphRef[] {
  const refs: GitGraphRef[] = [];
  for (const part of text.split(",")) {
    const item = part.trim();
    if (item === "" || item === "HEAD") continue;
    if (item.startsWith("tag: ")) {
      refs.push({ name: item.slice(5), kind: "tag" });
      continue;
    }
    const name = item.startsWith("HEAD -> ") ? item.slice(8) : item;
    refs.push({ name, kind: kinds.get(name) ?? (name.includes("/") ? "remote" : "branch") });
  }
  return refs;
}

/** git log 输出解析：%H%x1f%P%x1f%an%x1f%at%x1f%s%x1f%D 逐行一条。 */
export function parseGitLog(text: string, kinds: Map<string, GitGraphRef["kind"]>): GitGraphCommit[] {
  const commits: GitGraphCommit[] = [];
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    const [hash, parents, author, at, subject, decorations] = line.split(FIELD_SEP);
    if (!hash) continue;
    commits.push({
      hash,
      parents: (parents ?? "").split(" ").filter(Boolean),
      author: author ?? "",
      at: Number(at) || 0,
      subject: subject ?? "",
      refs: parseDecorations(decorations ?? "", kinds),
    });
  }
  return commits;
}

/** 图谱数据；非 Git 仓库 → null，空仓 → 空列表（对话框空态）。 */
export async function workspaceGitGraph(root: string): Promise<GitGraphData | null> {
  try {
    await git(root, ["rev-parse", "--is-inside-work-tree"]);
  } catch {
    return null;
  }
  let head: string | null = null;
  try {
    const name = (await git(root, ["rev-parse", "--abbrev-ref", "HEAD"])).trim();
    head = name === "HEAD" ? null : name;
  } catch {
    head = null;
  }
  try {
    const [logOut, refsOut] = await Promise.all([
      git(root, ["log", "--all", "--topo-order", `-n`, `${MAX_COMMITS + 1}`, `--pretty=format:%H%x1f%P%x1f%an%x1f%at%x1f%s%x1f%D`]),
      git(root, ["for-each-ref", "--format=%(refname)"]),
    ]);
    const commits = parseGitLog(logOut, parseRefKinds(refsOut));
    return { head, commits: commits.slice(0, MAX_COMMITS), truncated: commits.length > MAX_COMMITS };
  } catch {
    // 空仓（尚无提交）走空态而非失败态。
    return { head, commits: [], truncated: false };
  }
}
