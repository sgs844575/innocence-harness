// workspaceReview：真实临时 git 仓库的端到端用例（init→commit→改动/暂存/未跟踪）。
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { workspaceReviewFileDiff, workspaceReviewFiles } from "./workspaceReview";

let dir: string;
let plainDir: string;

const git = (args: string[]) =>
  execFileSync("git", ["-C", dir, ...args], { stdio: "pipe" }).toString();

beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), "ic-review-"));
  plainDir = mkdtempSync(path.join(tmpdir(), "ic-review-plain-"));
  execFileSync("git", ["init", dir], { stdio: "pipe" });
  git(["config", "user.email", "test@example.invalid"]);
  git(["config", "user.name", "test"]);
  git(["config", "core.autocrlf", "false"]);
  writeFileSync(path.join(dir, "a.ts"), "hello\nworld\n", "utf8");
  git(["add", "a.ts"]);
  git(["commit", "-m", "init"]);
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
  rmSync(plainDir, { recursive: true, force: true });
});

describe("workspaceReviewFiles", () => {
  it("非 Git 仓库 → null（面板空态）", async () => {
    expect(await workspaceReviewFiles(plainDir, "unstaged")).toBeNull();
  });

  it("未暂存：列出已跟踪修改与未跟踪新文件（含行数）", async () => {
    writeFileSync(path.join(dir, "a.ts"), "hello\nworld2\n", "utf8"); // 1+ 1-
    writeFileSync(path.join(dir, "新建.md"), "一\n二\n三\n", "utf8"); // 未跟踪 3 行
    const result = await workspaceReviewFiles(dir, "unstaged");
    expect(result).not.toBeNull();
    const modified = result!.files.find((f) => f.path === "a.ts");
    expect(modified).toMatchObject({ additions: 1, deletions: 1 });
    const untracked = result!.files.find((f) => f.path === "新建.md");
    expect(untracked).toMatchObject({ additions: 3, deletions: 0, untracked: true });
  });

  it("已暂存：只列 index 相对 HEAD 的改动", async () => {
    writeFileSync(path.join(dir, "b.ts"), "x\n", "utf8");
    git(["add", "b.ts"]); // 暂存新文件
    const staged = await workspaceReviewFiles(dir, "staged");
    expect(staged!.files.map((f) => f.path)).toContain("b.ts");
    // 未跟踪文件不进已暂存作用域
    expect(staged!.files.some((f) => f.untracked)).toBe(false);
  });
});

describe("workspaceReviewFileDiff", () => {
  it("已跟踪修改返回 unified patch 文本", async () => {
    const diff = await workspaceReviewFileDiff(dir, "unstaged", "a.ts");
    expect(diff?.kind).toBe("patch");
    if (diff?.kind === "patch") {
      expect(diff.patch).toContain("@@");
      expect(diff.patch).toContain("-world");
      expect(diff.patch).toContain("+world2");
    }
  });

  it("未跟踪文件返回全文（kind: untracked）", async () => {
    const diff = await workspaceReviewFileDiff(dir, "unstaged", "新建.md");
    expect(diff).toEqual({ kind: "untracked", text: "一\n二\n三\n" });
  });

  it("已暂存作用域下的未跟踪文件 → null", async () => {
    expect(await workspaceReviewFileDiff(dir, "staged", "新建.md")).toBeNull();
  });

  it("路径越界（..）与非仓库 → null", async () => {
    expect(await workspaceReviewFileDiff(dir, "unstaged", "../outside.ts")).toBeNull();
    expect(await workspaceReviewFileDiff(plainDir, "unstaged", "a.ts")).toBeNull();
  });
});
