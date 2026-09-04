// Git 提交/推送与提交信息摘要：直接 execFile 调用（不过 shell，windowsHide）。
// 全部返回结果对象、从不抛异常；失败摘要取 stderr/stdout 末个非空行。
// 提交信息留空时经注入的 generate 回调自动生成（宿主接 AI 服务，见 harnessGlue）。
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** porcelain 输出统计：行 = `XY path`，X = 暂存态，Y = 工作区态；`??` = 未跟踪。 */
export function countPorcelain(status: string): { changed: number; staged: number; unstaged: number } {
  let changed = 0;
  let staged = 0;
  let unstaged = 0;
  for (const line of status.split("\n")) {
    if (line.trim() === "") continue;
    changed += 1;
    const x = line[0] ?? " ";
    const y = line[1] ?? " ";
    if (x !== " " && x !== "?") staged += 1;
    if (y !== " " || line.startsWith("??")) unstaged += 1;
  }
  return { changed, staged, unstaged };
}

/** 文本末个非空行（trim 后）；全空 → ""。 */
export function lastLine(text: string): string {
  const lines = text.split("\n").map((line) => line.trim()).filter((line) => line !== "");
  return lines[lines.length - 1] ?? "";
}

/** execFile 拒绝错误上的 stdout/stderr 文本（非命令错误 → ""）。 */
function errorText(error: unknown, key: "stdout" | "stderr"): string {
  return typeof error === "object" && error !== null && key in error
    ? String((error as Record<string, unknown>)[key])
    : "";
}

export interface WorkspaceGitExecOptions {
  exec?: typeof execFileAsync;
}

/** AI 提交信息摘要：status --porcelain + diff --stat HEAD（空仓退化为工作区统计）。
 *  各封顶（status 200 行 / stat 4000 字符）；git 失败或两者皆空 → null。 */
export async function workspaceGitSummary(
  root: string,
  opts: WorkspaceGitExecOptions = {},
): Promise<string | null> {
  const exec = opts.exec ?? execFileAsync;
  try {
    const { stdout: status } = await exec("git", ["-C", root, "status", "--porcelain"], { windowsHide: true });
    let stat = "";
    try {
      ({ stdout: stat } = await exec("git", ["-C", root, "diff", "--stat", "HEAD"], { windowsHide: true }));
    } catch {
      // 空仓无 HEAD：退化为工作区+暂存统计。
      ({ stdout: stat } = await exec("git", ["-C", root, "diff", "--stat"], { windowsHide: true }));
    }
    const statusText = status.split("\n").slice(0, 200).join("\n").trim();
    const statText = stat.slice(0, 4000).trim();
    if (statusText === "" && statText === "") return null;
    return `## git status\n${statusText}\n\n## git diff --stat\n${statText}`;
  } catch {
    return null;
  }
}

/** 提交：message 为空时先取摘要并交给 generate 生成；stageAll 时先 add -A。 */
export async function workspaceGitCommit(
  root: string,
  message: string,
  stageAll: boolean,
  opts: WorkspaceGitExecOptions & { generate?: (summary: string) => Promise<string> } = {},
): Promise<{ ok: boolean; summary?: string; error?: string }> {
  const exec = opts.exec ?? execFileAsync;
  let text = message.trim();
  if (text === "") {
    if (!opts.generate) return { ok: false, error: "empty commit message" };
    const summary = await workspaceGitSummary(root, { exec });
    if (summary === null) return { ok: false, error: "nothing to commit" };
    try {
      text = await opts.generate(summary);
    } catch (error) {
      return { ok: false, error: String(error) };
    }
  }
  if (stageAll) {
    try {
      await exec("git", ["-C", root, "add", "-A"], { windowsHide: true });
    } catch (error) {
      return { ok: false, error: lastLine(errorText(error, "stderr")) || "add failed" };
    }
  }
  try {
    const { stdout } = await exec("git", ["-C", root, "commit", "-m", text], { windowsHide: true });
    return { ok: true, summary: lastLine(stdout) };
  } catch (error) {
    return {
      ok: false,
      error: lastLine(errorText(error, "stderr")) || lastLine(errorText(error, "stdout")) || "commit failed",
    };
  }
}

/** 推送：无上游分支时自动 --set-upstream origin HEAD 重试一次。 */
export async function workspaceGitPush(
  root: string,
  opts: WorkspaceGitExecOptions = {},
): Promise<{ ok: boolean; error?: string }> {
  const exec = opts.exec ?? execFileAsync;
  try {
    await exec("git", ["-C", root, "push"], { windowsHide: true });
    return { ok: true };
  } catch (error) {
    const stderr = errorText(error, "stderr");
    if (!/upstream|set-upstream/i.test(stderr)) {
      return { ok: false, error: lastLine(stderr) || "push failed" };
    }
  }
  try {
    await exec("git", ["-C", root, "push", "--set-upstream", "origin", "HEAD"], { windowsHide: true });
    return { ok: true };
  } catch (error) {
    return { ok: false, error: lastLine(errorText(error, "stderr")) || "push failed" };
  }
}
