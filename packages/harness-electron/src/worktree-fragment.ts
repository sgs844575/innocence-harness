// Worktree-session isolation discipline fragment (S2a). Lives in the
// host-adjacent package so BOTH faces share one source: the composition root
// registers it for worktree route sessions, and the spawner child-session
// factory registers it for subagents spawned inside such a session.
import type { PromptFragment } from "@innocenceharness/harness-system-prompt";

/**
 * 隔离纪律片段（源件 background-worktree-isolation 语义的会话内改编）：
 * 仅对运行在任务管理工作树中的会话注册（共享桶，全模式生效）。
 */
export const WORKTREE_ISOLATION_FRAGMENT: PromptFragment = {
  id: "shared.worktree.isolation",
  order: 1160,
  render: () =>
    [
      "## Isolated worktree discipline",
      "",
      "This session runs inside a task-managed isolated worktree — the same repository and relative layout as the main working copy, but a separate working tree of your own.",
      "",
      "- Everything you write stays inside this worktree; accepted changes reach the user's checkout only through the task review. The shared checkout is out of bounds; attempts to reach paths outside your workspace root fail by design, so work here instead of fighting that boundary.",
      "- Read-only exploration needs no special handling — work in place.",
      "- When your changes are complete, leave them committed in this worktree as one coherent commit so a human reviewer can see a single unit of intent; the task review itself works from the captured file changes either way.",
      "- Never rewrite history, reset, or switch branches here: the task's checkpoint and review machinery depends on the working tree state.",
      "- Parallel work may exist elsewhere in the repository — re-read a file before editing it if your last view of it could be stale.",
    ].join("\n"),
};
