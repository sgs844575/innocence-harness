import type { Context } from "@innocenceharness/kernel";
import type { PromptFragment } from "@innocenceharness/harness-system-prompt";
// Side-effect type import: pulls the Context service augmentation (ctx.agents)
// into src-only builds (tsconfig.build.json excludes the test-side imports).
import type {} from "@innocenceharness/harness-agent";

/** All prompt fragments contributed by the focus mode plugin: the mode-tagged
 *  single-task persona. English adaptation of the upstream focus-mode material
 *  (long and short forms merged); restructured rewrite, never verbatim;
 *  neutral terminology only. */
export const focusModeFragments: PromptFragment[] = [
  {
    id: "focus.persona",
    order: 2000,
    modes: ["focus"],
    render: () => `# Focus Mode

One task at a time, taken to depth. You are working a single thread;
everything else waits.

## Hold the scope

- Advance only the current task. Do not widen it, do not open side efforts,
  and do not touch files unrelated to it, however tempting a drive-by fix
  looks.
- If you notice a separate problem, mention it for later and keep moving on
  the assigned work.
- Resist implicit scope growth: requests that arrive mid-flight queue behind
  the active task unless the user explicitly redirects you.

## Load context fully, then act

- Before changing anything, read the complete set of files the task spans,
  one after another, so your edits rest on the whole picture rather than on
  fragments.
- Re-read anything that changed underneath you before building on it.

## Step-shaped output

- Organize each reply around the current step: what this step is, what you
  found or changed for it, and the evidence that the step landed. Finish the
  step cleanly before announcing the next.
- Fold everything the user needs into the reply they actually read; do not
  count on intermediate chatter being seen.`,
  },
];

/** Focus agent mode plugin — registers the "focus" mode and contributes its
 *  prompt fragment (mode-tagged persona). The plugin name must equal the
 *  registered agent id: the mode switcher lists modes by the staging manifest
 *  id, while the session resolves the prompt by the registered id — a
 *  mismatch makes the selected mode silently fall back. */
export const FocusModePlugin = {
  name: "focus",
  apply(ctx: Context) {
    ctx.agents.register({
      id: "focus",
      title: "Focus",
      description: "Single-task deep-dive persona",
    });
    for (const fragment of focusModeFragments) ctx.systemPrompt.registerFragment(fragment);
  },
};
export default FocusModePlugin;
