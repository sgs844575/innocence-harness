import { describe, expect, it, vi } from "vitest";
import {
  countPorcelain,
  lastLine,
  workspaceGitCommit,
  workspaceGitPush,
  workspaceGitSummary,
} from "./workspaceCommit";

/** 模拟 execFile 拒绝：git 失败错误上挂 stdout/stderr。 */
function gitError(stderr: string, stdout = ""): Error {
  return Object.assign(new Error("git failed"), { stdout, stderr });
}

/** 测试替身执行器：以子命令串（-C root 之后的参数）查表返回/抛错，并记录全部调用。 */
function fakeExec(map: Record<string, { stdout?: string; stderr?: string } | Error>) {
  const calls: string[][] = [];
  const exec = async (_file: string, args: string[]) => {
    calls.push(args.slice(2));
    const hit = map[args.slice(2).join(" ")];
    if (hit === undefined) throw new Error(`unexpected git call: ${args.slice(2).join(" ")}`);
    if (hit instanceof Error) throw hit;
    return { stdout: hit.stdout ?? "", stderr: hit.stderr ?? "" };
  };
  return { exec: exec as never, calls };
}

describe("countPorcelain", () => {
  it("按 XY 状态位统计：未跟踪/已暂存/未暂存/混合", () => {
    expect(countPorcelain("?? new.ts\n")).toEqual({ changed: 1, staged: 0, unstaged: 1 });
    expect(countPorcelain("M  a.ts\nA  b.ts\n")).toEqual({ changed: 2, staged: 2, unstaged: 0 });
    expect(countPorcelain(" M a.ts")).toEqual({ changed: 1, staged: 0, unstaged: 1 });
    expect(countPorcelain("MM a.ts")).toEqual({ changed: 1, staged: 1, unstaged: 1 });
    expect(countPorcelain("\n \n")).toEqual({ changed: 0, staged: 0, unstaged: 0 });
  });
});

describe("lastLine", () => {
  it("取末个非空行；全空返回空串", () => {
    expect(lastLine("first\nlast\n\n")).toBe("last");
    expect(lastLine("\n  \n")).toBe("");
  });
});

describe("workspaceGitCommit", () => {
  it("stageAll 时先 add -A 再 commit，成功回传 stdout 末行摘要", async () => {
    const { exec, calls } = fakeExec({
      "add -A": {},
      'commit -m my message': { stdout: "[main abc123] my message\n 1 file changed, 2 insertions(+)\n" },
    });
    const result = await workspaceGitCommit("D:/x", "my message", true, { exec });
    expect(result).toEqual({ ok: true, summary: "1 file changed, 2 insertions(+)" });
    expect(calls.map((args) => args.join(" "))).toEqual(["add -A", "commit -m my message"]);
  });

  it("stageAll=false 时不调用 add", async () => {
    const { exec, calls } = fakeExec({ "commit -m msg": { stdout: "done\n" } });
    const result = await workspaceGitCommit("D:/x", "msg", false, { exec });
    expect(result.ok).toBe(true);
    expect(calls.map((args) => args.join(" "))).toEqual(["commit -m msg"]);
  });

  it("commit 失败取 stderr 末行；stderr 空时退化 stdout 末行", async () => {
    const { exec } = fakeExec({
      "commit -m msg": gitError("fatal: line one\nerror: line two\n"),
    });
    expect(await workspaceGitCommit("D:/x", "msg", false, { exec })).toEqual({ ok: false, error: "error: line two" });
    const { exec: exec2 } = fakeExec({ "commit -m msg": gitError("", "hint from stdout") });
    expect(await workspaceGitCommit("D:/x", "msg", false, { exec: exec2 })).toEqual({ ok: false, error: "hint from stdout" });
  });

  it("add -A 失败即返错，不再 commit", async () => {
    const { exec, calls } = fakeExec({ "add -A": gitError("fatal: locked index") });
    expect(await workspaceGitCommit("D:/x", "msg", true, { exec })).toEqual({ ok: false, error: "fatal: locked index" });
    expect(calls.map((args) => args.join(" "))).toEqual(["add -A"]);
  });

  it("空提交信息：先取摘要交给 generate，生成结果作为提交信息", async () => {
    const { exec } = fakeExec({
      "status --porcelain": { stdout: " M a.ts\n" },
      "diff --stat HEAD": { stdout: " a.ts | 2 +-\n" },
      "commit -m generated subject": { stdout: "ok\n" },
    });
    const seen: string[] = [];
    const result = await workspaceGitCommit("D:/x", "  ", false, {
      exec,
      generate: async (summary) => {
        seen.push(summary);
        return "generated subject";
      },
    });
    expect(result.ok).toBe(true);
    expect(seen).toEqual(["## git status\nM a.ts\n\n## git diff --stat\na.ts | 2 +-"]);
  });

  it("空提交信息且无更改 → nothing to commit（不调用 generate）", async () => {
    const { exec } = fakeExec({
      "status --porcelain": { stdout: "\n" },
      "diff --stat HEAD": { stdout: "\n" },
    });
    const generate = vi.fn(async () => "unused");
    expect(await workspaceGitCommit("D:/x", "", false, { exec, generate })).toEqual({
      ok: false,
      error: "nothing to commit",
    });
    expect(generate).not.toHaveBeenCalled();
  });

  it("空提交信息且未注入 generate → empty commit message", async () => {
    const { exec } = fakeExec({});
    expect(await workspaceGitCommit("D:/x", "", false, { exec })).toEqual({ ok: false, error: "empty commit message" });
  });

  it("generate 抛错 → ok:false 且错误字符串化", async () => {
    const { exec } = fakeExec({
      "status --porcelain": { stdout: " M a.ts\n" },
      "diff --stat HEAD": { stdout: "" },
    });
    const result = await workspaceGitCommit("D:/x", "", false, {
      exec,
      generate: async () => {
        throw new Error("model offline");
      },
    });
    expect(result).toEqual({ ok: false, error: "Error: model offline" });
  });
});

describe("workspaceGitSummary", () => {
  it("空仓无 HEAD：diff --stat HEAD 失败后退化 diff --stat", async () => {
    const { exec, calls } = fakeExec({
      "status --porcelain": { stdout: "?? new.ts\n" },
      "diff --stat HEAD": gitError("fatal: ambiguous argument 'HEAD'"),
      "diff --stat": { stdout: "" },
    });
    const summary = await workspaceGitSummary("D:/x", { exec });
    expect(summary).toBe("## git status\n?? new.ts\n\n## git diff --stat\n");
    expect(calls.map((args) => args.join(" "))).toEqual(["status --porcelain", "diff --stat HEAD", "diff --stat"]);
  });

  it("status 失败 → null", async () => {
    const { exec } = fakeExec({ "status --porcelain": gitError("fatal: not a git repository") });
    expect(await workspaceGitSummary("D:/x", { exec })).toBeNull();
  });
});

describe("workspaceGitPush", () => {
  it("无上游错误 → --set-upstream origin HEAD 重试一次后成功", async () => {
    const { exec, calls } = fakeExec({
      push: gitError("fatal: The current branch main has no upstream branch.\nTo push the current branch and set the remote as upstream, use"),
      "push --set-upstream origin HEAD": {},
    });
    expect(await workspaceGitPush("D:/x", { exec })).toEqual({ ok: true });
    expect(calls.map((args) => args.join(" "))).toEqual(["push", "push --set-upstream origin HEAD"]);
  });

  it("普通失败（无 upstream 提示）不重试，直接回 stderr 末行", async () => {
    const { exec, calls } = fakeExec({
      push: gitError("remote: Permission denied.\nfatal: unable to access"),
    });
    expect(await workspaceGitPush("D:/x", { exec })).toEqual({ ok: false, error: "fatal: unable to access" });
    expect(calls).toHaveLength(1);
  });

  it("重试仍失败 → 回重试的 stderr 末行", async () => {
    const { exec } = fakeExec({
      push: gitError("fatal: no upstream branch"),
      "push --set-upstream origin HEAD": gitError("error: failed to push some refs"),
    });
    expect(await workspaceGitPush("D:/x", { exec })).toEqual({ ok: false, error: "error: failed to push some refs" });
  });
});
