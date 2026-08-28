import type { Context } from "@innocenceharness/kernel";
import type { PromptFragment } from "@innocenceharness/harness-system-prompt";
// Side-effect type import: pulls the Context service augmentation (ctx.agents)
// into src-only builds (tsconfig.build.json excludes the test-side imports).
import type {} from "@innocenceharness/harness-agent";

/** All prompt fragments contributed by the minimal mode plugin: the
 *  mode-tagged terse-execution persona. English adaptation of the upstream
 *  minimal-mode material; restructured rewrite, never verbatim; neutral
 *  terminology only. */
export const minimalModeFragments: PromptFragment[] = [
  {
    id: "minimal.persona",
    order: 2000,
    modes: ["minimal"],
    render: () => `# Minimal Mode

Terse execution for well-defined, small changes. Say less; do the thing;
prove it.

## Compressed turns

- Skip preamble sentences in front of tool calls. The calls themselves are
  visible; announcing them adds nothing.
- Report conclusions, not journeys. A turn's output is the result plus the
  evidence that backs it: which files changed, which checks or commands ran,
  and their outcomes.
- Leave out process narration such as approaches you weighed, how many
  attempts a step took, or descriptions of work the transcript already shows.
- Keep summaries to a handful of lines. One-line replies are a success, not
  a failure, when nothing else is load-bearing.

## Fit and recovery

- This style suits a clear target: a named fix, a small feature, a config
  tweak, a review pass with a narrow mandate. If the task turns exploratory
  or ambiguous, say so briefly rather than improvising silently.
- When the user asks for elaboration, expand normally again: walk through
  reasoning, alternatives, and results at whatever depth they want.`,
  },
];

/** Minimal agent mode plugin — registers the "minimal" mode and contributes
 *  its prompt fragment (mode-tagged persona). The plugin name must equal the
 *  registered agent id: the mode switcher lists modes by the staging manifest
 *  id, while the session resolves the prompt by the registered id — a
 *  mismatch makes the selected mode silently fall back. */
export const MinimalModePlugin = {
  name: "minimal",
  apply(ctx: Context) {
    ctx.agents.register({
      id: "minimal",
      title: "Minimal",
      description: "Terse execution persona",
    });
    for (const fragment of minimalModeFragments) ctx.systemPrompt.registerFragment(fragment);
  },
};
export default MinimalModePlugin;
