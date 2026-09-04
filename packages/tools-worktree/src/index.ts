// S4/A:58 EnterWorktree 半边：武装会话（后台作业）的文件写入隔离面。
// 围栏 = 写类工具（Write/Edit）的目标必须位于 <workspaceRoot>/.innocence/
// worktrees/ 之下——由 EnterWorktree 工具创建（git 嵌套 worktree，自 HEAD
// 分离；.innocence 为本仓命名空间，glob/grep 忽略表已含）。只读不受限；
// EnterWorktree 失败（非 Git 仓库等）按源件语义"就地继续"（围栏仍在，即
// 只读+暂存目录）。shell 旁路为已知边界（围栏面是文件工具，不含 Bash——
// 与源件"file edits rejected"口径一致）。
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Tool, ToolContext, ToolExecutionMiddleware } from "@innocenceharness/harness-tools";
import type { Context, ObjectPlugin } from "@innocenceharness/kernel";

const execFileAsync = promisify(execFile);

/** 工作树目录约定（相对工作区根）。 */
export const WORKTREE_DIR = ".innocence/worktrees";

export type GitRunner = (cwd: string, args: readonly string[]) => Promise<string>;

/** 生产 git 执行面（execFile，无 shell）。 */
export const defaultGitRunner: GitRunner = async (cwd, args) => {
  const { stdout } = await execFileAsync("git", [...args], { cwd, encoding: "utf8" });
  return stdout;
};

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\.\//, "").toLowerCase();
}

/** 写入目标是否位于隔离工作树命名空间内（相对或绝对形式皆可判）。 */
export function isInsideWorktreeNamespace(rawPath: string): boolean {
  const p = normalizePath(rawPath);
  return p.startsWith(`${WORKTREE_DIR}/`) || p.includes(`/${WORKTREE_DIR}/`);
}

/** 需要围栏的写类工具（以持久化参数中的 path 为目标）。 */
const FENCED_WRITE_TOOLS = new Set(["Write", "Edit"]);

const FENCE_REJECTION =
  "[隔离围栏：本会话的文件写入已被隔离——先调用 EnterWorktree 创建隔离工作树，再以其中的路径为写入目标；只读与 Bash 不受限，暂存目录仍可用。若 EnterWorktree 不可用（如非 Git 仓库），就地只读继续]";

/**
 * 写入围栏中间件：武装会话恒挂载。写类工具目标不在工作树命名空间内时
 * 短路拒绝（不执行工具本体）；其余调用原样放行。
 */
export function worktreeFenceMiddleware(): ToolExecutionMiddleware {
  return {
    name: "worktree-fence",
    async execute(invocation, next) {
      if (FENCED_WRITE_TOOLS.has(invocation.toolName)) {
        const target = String(invocation.args.path ?? "");
        if (!isInsideWorktreeNamespace(target)) {
          return { content: FENCE_REJECTION, isError: true };
        }
      }
      return next();
    },
  };
}

export interface EnterWorktreeDeps {
  runGit?: GitRunner;
  /** 测试缝：目录名生成（缺省按时间戳）。 */
  mintName?: () => string;
}

/** EnterWorktree 工具：在 <root>/.innocence/worktrees/ 下创建分离工作树。 */
export function createEnterWorktreeTool(deps: EnterWorktreeDeps = {}): Tool {
  const runGit = deps.runGit ?? defaultGitRunner;
  const mintName = deps.mintName ?? (() => `wt_${Date.now().toString(36)}`);
  return {
    name: "EnterWorktree",
    description:
      "在 .innocence/worktrees/ 下创建一个自当前 HEAD 分离的隔离工作树并进入之——本会话的文件写入仅在该命名空间内被允许。代码改动前调用；纯阅读无需调用。",
    readOnly: false,
    sideEffect: "paths",
    parameters: { type: "object", properties: {} },
    async validateArgs() {},
    permissionResource() {
      return { action: "write", kind: "path", scope: WORKTREE_DIR };
    },
    async execute(_args, ctx: ToolContext) {
      const relative = `${WORKTREE_DIR}/${mintName()}`;
      try {
        const inside = (await runGit(ctx.workspaceRoot, ["rev-parse", "--is-inside-work-tree"])).trim();
        if (inside !== "true") {
          return {
            content: "[EnterWorktree 不可用：当前工作区不是 Git 仓库；就地只读继续，暂存目录仍可写]",
            isError: true,
          };
        }
        await runGit(ctx.workspaceRoot, ["worktree", "add", "--detach", relative, "HEAD"]);
      } catch (error) {
        return {
          content:
            `[EnterWorktree 失败（${error instanceof Error ? error.message : String(error)}）；` +
            "就地继续——只读与暂存目录不受影响]",
          isError: true,
        };
      }
      return {
        content:
          `[已进入隔离工作树 ${relative}（自当前 HEAD 分离）。后续 Write/Edit 以该目录内的路径为目标；` +
          "完成后按收尾纪律在该工作树内留下一次连贯提交。注意：工作树反映 HEAD 提交状态，未提交的工作区改动不在其中]",
      };
    },
  };
}

/**
 * 围栏插件（宿主按会话武装——仅后台作业等显式开启隔离的会话组合注入）：
 * 注册 EnterWorktree 工具 + 写入围栏中间件。
 */
export function createWorktreeFencePlugin(deps: EnterWorktreeDeps = {}): ObjectPlugin {
  return {
    name: "worktree-fence",
    apply(ctx: Context) {
      ctx.tools.register(createEnterWorktreeTool(deps));
      ctx.tools.registerMiddleware(worktreeFenceMiddleware());
    },
  };
}
