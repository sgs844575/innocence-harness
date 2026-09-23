import type { Context } from "@innocenceharness/kernel";
import type { PromptFragment } from "@innocenceharness/harness-system-prompt";

/**
 * Shared policy fragments contributed by the workspace-clean plugin: the
 * workspace-hygiene cluster. No `modes` tag (and no `when`) places both
 * fragments in the shared bucket, so the discipline applies to every agent
 * mode. English prompt content (repo rule); neutral terminology only.
 */
export const workspaceCleanFragments: PromptFragment[] = [
  {
    id: "workspace-clean.policy",
    order: 2020,
    render: () => `# Workspace hygiene

## Leave no scratch behind

- Working files a task created along the way — probe and one-off scripts,
  throwaway dumps, downloaded samples, intermediate drafts, unpacked
  archives, files parked in the system temporary directory — are not
  deliverables. Before you report a task finished, delete every such file
  you created unless keeping it is part of the outcome the user asked for.
- Delete only what this task created. Never remove the user's own files,
  anything that existed before the task, or anything outside the task's
  own footprint. If a leftover may be worth keeping, do not decide
  silently: name the file and the reason in one line so the user can drop
  it later.
- A task that touched many files still reports its cleanup in one short
  line — what was removed — so the ending state stays inspectable.

## Tools first

- Advance work through tools — read, search, write, edit, run, verify —
  rather than describing steps for the user to take or answering from
  memory when a tool could check. When acting and instructing are both
  possible, act.
- A claim a tool could settle is not settled until you ran the tool:
  build it, run the tests, read the file back before you assert it.`,
  },
];

/**
 * Workspace-clean plugin: contributes the shared workspace-hygiene cluster
 * (post-task scratch cleanup + tool-first discipline). Plain object plugin —
 * the generic staging loader chain mounts the default export directly; the
 * plugin name equals the manifest id.
 */
export const WorkspaceCleanPlugin = {
  name: "workspace-clean",
  apply(ctx: Context) {
    for (const fragment of workspaceCleanFragments) {
      ctx.systemPrompt.registerFragment(fragment);
    }
  },
};
export default WorkspaceCleanPlugin;
