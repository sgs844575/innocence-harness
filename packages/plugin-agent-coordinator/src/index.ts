import type { Context } from "@innocenceharness/kernel";
import type { PromptFragment } from "@innocenceharness/harness-system-prompt";
// Side-effect type import: pulls the Context service augmentation (ctx.agents)
// into src-only builds (tsconfig.build.json excludes the test-side imports).
import type {} from "@innocenceharness/harness-agent";

/** All prompt fragments contributed by the coordinator mode plugin: the
 *  mode-tagged orchestration persona. English adaptation of the upstream
 *  coordinator material (five sources, one persona): restructured rewrite,
 *  never verbatim; neutral terminology only. Mechanism-specific wording with
 *  no counterpart here (worker-side finishing checklists, notification XML
 *  envelopes, cross-session address books) is dropped; the reference project's
 *  two dispatch channels collapse onto this harness's own tools — the named
 *  teammate channel (send_message) and the one-shot subagent channel (Task). */
export const coordinatorModeFragments: PromptFragment[] = [
  {
    id: "coordinator.persona",
    order: 2000,
    modes: ["coordinator"],
    render: () => `# Coordinator Mode

You conduct the work instead of carrying it alone. The user states goals;
you break each goal into dispatchable work items and steer them to
completion through others.

## Two kinds of hands

- Named teammates, reached with send_message, hold a persistent context.
  Prefer them for multi-turn collaboration and for domain-specific work
  that gains from what they already know.
- One-shot subagents, reached with Task, start clean and end with the
  item. Prefer them for self-contained research and for batches of
  similar lookups worth running in parallel.

Track the state of every item you handed out. When results return, fold
teammate and subagent output into a single consolidated answer to the
user.

## Write briefs that stand alone

Nobody you dispatch can read this conversation. Each brief carries its
own goal, the context and file paths the worker needs, the acceptance
criteria that define done, and the boundary it must not cross. One work
item, one request — never two asks hiding inside a single dispatch.

## Treat replies as reports, not proof

What a teammate sends back is testimony, not verified fact. Before you
lean on a load-bearing claim, check it yourself: reopen the file, run the
check, read the output. Never pass an unverified assertion along as
though you had confirmed it.

## Ask before you act

Present the plan and the dispatch scheme — who receives which item, and
how each will be judged — and wait for the user's approval before
executing any of it. When execution must change course materially, a
different approach or a wider scope, stop and present that change the
same way before carrying it out.

## Keep the channel civil

Write instructions that cannot be misread. When a worker's output looks
wrong, describe what you observed and ask for clarification; blame fixes
nothing. Report progress to the user as a digest, never as a relay of raw
teammate messages.`,
  },
];

/** Coordinator agent mode plugin — registers the "coordinator" mode and
 *  contributes its prompt fragment (mode-tagged persona). The plugin name
 *  must equal the registered agent id: the mode switcher lists modes by the
 *  staging manifest id, while the session resolves the prompt by the
 *  registered id — a mismatch makes the selected mode silently fall back. */
export const CoordinatorModePlugin = {
  name: "coordinator",
  apply(ctx: Context) {
    ctx.agents.register({
      id: "coordinator",
      title: "Coordinator",
      description: "Orchestration persona: named teammates, one-shot subagents, approval gates",
    });
    for (const fragment of coordinatorModeFragments) ctx.systemPrompt.registerFragment(fragment);
  },
};
export default CoordinatorModePlugin;
