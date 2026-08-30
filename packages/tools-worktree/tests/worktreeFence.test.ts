// A:58 EnterWorktree 半边测试：围栏拒绝/放行/只读不受限、工具成功/非 Git/
// 失败降级、插件注册面。
import { describe, expect, it } from "vitest";
import { Context } from "@innocenceharness/kernel";
import { ToolsPlugin } from "@innocenceharness/harness-tools";
import {
  createEnterWorktreeTool,
  createWorktreeFencePlugin,
  isInsideWorktreeNamespace,
  worktreeFenceMiddleware,
  type GitRunner,
} from "../src";

const invocation = (toolName: string, persistedArgs: Record<string, unknown>) => ({
  invocationId: "inv-1",
  toolName,
  persistedArgs,
  signal: new AbortController().signal,
  scope: { invocationId: "inv-1", toolName, sessionId: "s1" },
});

const nextBody = async () => ({ content: "WROTE" });

describe("worktree write fence", () => {
  it("rejects Write/Edit outside the namespace and passes inside it", async () => {
    const fence = worktreeFenceMiddleware();
    const rejected = await fence.execute(invocation("Write", { path: "src/a.ts" }), nextBody);
    expect(rejected.isError).toBe(true);
    expect(rejected.content).toContain("EnterWorktree");
    const rejectedAbs = await fence.execute(
      invocation("Edit", { path: "D:/repo/src/a.ts" }),
      nextBody,
    );
    expect(rejectedAbs.isError).toBe(true);

    const allowed = await fence.execute(
      invocation("Write", { path: ".innocence/worktrees/wt_x/src/a.ts" }),
      nextBody,
    );
    expect(allowed).toEqual({ content: "WROTE" });
    const allowedAbs = await fence.execute(
      invocation("Edit", { path: "D:/repo/.innocence/worktrees/wt_x/a.ts" }),
      nextBody,
    );
    expect(allowedAbs).toEqual({ content: "WROTE" });
  });

  it("read-only tools and shell pass through untouched", async () => {
    const fence = worktreeFenceMiddleware();
    for (const tool of ["Read", "Grep", "Bash"]) {
      const r = await fence.execute(invocation(tool, { path: "src/a.ts" }), nextBody);
      expect(r).toEqual({ content: "WROTE" });
    }
  });

  it("namespace matcher tolerates case and separator forms", () => {
    expect(isInsideWorktreeNamespace(".\\.innocence\\worktrees\\wt1\\a.ts")).toBe(true);
    expect(isInsideWorktreeNamespace(".INNOCENCE/WORKTREES/wt1/a.ts")).toBe(true);
    expect(isInsideWorktreeNamespace("src/.innocence/other/a.ts")).toBe(false);
  });
});

describe("EnterWorktree tool", () => {
  const ctx = {
    workspaceRoot: "D:/repo",
    signal: new AbortController().signal,
    log: () => {},
    scope: { invocationId: "inv-2", toolName: "EnterWorktree" },
  };

  it("creates a detached worktree under the namespace and returns discipline", async () => {
    const calls: Array<{ cwd: string; args: readonly string[] }> = [];
    const runGit: GitRunner = async (cwd, args) => {
      calls.push({ cwd, args });
      if (args[0] === "rev-parse") return "true\n";
      return "";
    };
    const tool = createEnterWorktreeTool({ runGit, mintName: () => "wt_test" });
    const r = await tool.execute({}, ctx as never);
    expect(calls.map((c) => c.args.join(" "))).toEqual([
      "rev-parse --is-inside-work-tree",
      "worktree add --detach .innocence/worktrees/wt_test HEAD",
    ]);
    expect(r.content).toContain(".innocence/worktrees/wt_test");
    expect(r.content).toContain("HEAD");
    expect(r.isError).toBeUndefined();
  });

  it("non-git and failing runs degrade to continue-in-place guidance", async () => {
    const notGit = createEnterWorktreeTool({
      runGit: async () => "false\n",
      mintName: () => "wt_x",
    });
    expect((await notGit.execute({}, ctx as never)).isError).toBe(true);

    const failing = createEnterWorktreeTool({
      runGit: async (_cwd, args) => {
        if (args[0] === "worktree") throw new Error("worktree boom");
        return "true\n";
      },
      mintName: () => "wt_y",
    });
    const r = await failing.execute({}, ctx as never);
    expect(r.isError).toBe(true);
    expect(r.content).toContain("worktree boom");
    expect(r.content).toContain("就地继续");
  });

  it("persistence face: no args, constant namespace resource", () => {
    const tool = createEnterWorktreeTool({ runGit: async () => "", mintName: () => "w" });
    expect(tool.persistArgs({})).toEqual({});
    expect(tool.permissionResource({}, ctx as never)).toEqual({
      action: "write",
      kind: "path",
      scope: ".innocence/worktrees",
    });
  });
});

describe("worktree fence plugin registration", () => {
  it("registers the tool and the middleware on the kernel tools service", async () => {
    const ctx = new Context();
    await ctx.plugin(ToolsPlugin);
    await ctx.plugin(createWorktreeFencePlugin({ runGit: async () => "true\n" }));
    expect(ctx.tools.get("EnterWorktree")).toBeDefined();
    expect(ctx.tools.middlewares().map((m) => m.name)).toContain("worktree-fence");
  });
});
