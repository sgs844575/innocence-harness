// S2a 工作树会话判定（纯函数）：持久身份键（isolated 模式 / 工作树存储
// 目录前缀），覆盖恢复路径的字符串不等式误报场景。
import { describe, expect, it } from "vitest";
import { isWorktreeSession } from "./taskWorktreePredicate";

const STORAGE = "C:/userData/tasks/worktrees";

describe("isWorktreeSession (S2a)", () => {
  it("flags isolated mode regardless of path form", () => {
    expect(isWorktreeSession({ mode: "isolated", workspaceRoot: "D:/proj" }, STORAGE)).toBe(true);
  });

  it("flags route roots under the worktree storage directory (not siblings)", () => {
    expect(isWorktreeSession({ mode: "baseline", workspaceRoot: `${STORAGE}/t1/route_1` }, STORAGE)).toBe(true);
    expect(isWorktreeSession({ mode: "baseline", workspaceRoot: `${STORAGE}-other/t1` }, STORAGE)).toBe(false);
  });

  it("does not flag the user's own checkout — even a repo subdirectory on the recovery path", () => {
    // 恢复路径 userWorkspaceRoot 来自 git toplevel；子目录工作区曾令字符串
    // 不等式误报。持久身份键不受影响。
    expect(isWorktreeSession({ mode: "baseline", workspaceRoot: "D:/repo/packages/app" }, STORAGE)).toBe(false);
    expect(isWorktreeSession({ mode: "baseline", workspaceRoot: "D:/proj" }, STORAGE)).toBe(false);
  });

  it("missing handle or root is not a worktree session", () => {
    expect(isWorktreeSession(undefined, STORAGE)).toBe(false);
    expect(isWorktreeSession({ mode: "baseline" }, STORAGE)).toBe(false);
    expect(isWorktreeSession({ mode: "baseline", workspaceRoot: "" }, STORAGE)).toBe(false);
  });
});
