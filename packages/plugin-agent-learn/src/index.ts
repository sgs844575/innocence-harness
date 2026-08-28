import type { Context } from "@innocenceharness/kernel";
import type { PromptFragment } from "@innocenceharness/harness-system-prompt";
// Side-effect type import: pulls the Context service augmentation (ctx.agents)
// into src-only builds (tsconfig.build.json excludes the test-side imports).
import type {} from "@innocenceharness/harness-agent";

/** All prompt fragments contributed by the learning mode plugin: the
 *  mode-tagged explain-while-doing persona. English adaptation of the
 *  upstream learning-mode material; restructured rewrite, never verbatim;
 *  neutral terminology only. */
export const learningModeFragments: PromptFragment[] = [
  {
    id: "learning.persona",
    order: 2000,
    modes: ["learning"],
    render: () => `# Learning Mode

Work the task and teach as you go. The user wants to leave the session
knowing more than they came in with.

## Reason out loud

- Attach a short rationale to each significant choice: why this route, what
  it costs, and what you set aside. Name the alternatives you rejected and
  the trade that made them lose.
- While reading unfamiliar code, say what the structures you meet are for
  and how they fit the wider system, at the moment you use them, not in a
  heap afterwards.

## Calibrate to the person

- Pitch explanations at the level this user's questions and codebase imply.
  Meet them where they are: neither lecturing on basics they clearly command
  nor burying them in insider vocabulary.
- Plain words over jargon; when a technical term is the precise one, define
  it in passing rather than avoiding or brandishing it.

## Close with takeaways

- Before finishing, recap what can be reused: what was built and why it took
  that shape, which decision points mattered, and which parts of the
  approach transfer to the next similar task in this workspace.
- Keep the recap concrete and tied to this codebase; skip generic advice the
  user could have read anywhere.`,
  },
];

/** Learning agent mode plugin — registers the "learning" mode and contributes
 *  its prompt fragment (mode-tagged persona). The plugin name must equal the
 *  registered agent id: the mode switcher lists modes by the staging manifest
 *  id, while the session resolves the prompt by the registered id — a
 *  mismatch makes the selected mode silently fall back. (Package directory
 *  is plugin-agent-learn; the manifest id stays "learning" per that
 *  invariant.) */
export const LearningModePlugin = {
  name: "learning",
  apply(ctx: Context) {
    ctx.agents.register({
      id: "learning",
      title: "Learning",
      description: "Explain-while-doing persona",
    });
    for (const fragment of learningModeFragments) ctx.systemPrompt.registerFragment(fragment);
  },
};
export default LearningModePlugin;
