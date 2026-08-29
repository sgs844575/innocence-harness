import type { Context } from "@innocenceharness/kernel";
import type { PromptFragment } from "@innocenceharness/harness-system-prompt";
// Side-effect type import: pulls the Context service augmentation (ctx.agents)
// into src-only builds (tsconfig.build.json excludes the test-side imports).
import type {} from "@innocenceharness/harness-agent";
import { identityFragments } from "./fragments/identity";
import { communicationFragments } from "./fragments/communication";
import { safetyFragments } from "./fragments/safety";
import { taskDisciplineFragments } from "./fragments/taskDiscipline";
import { toolPolicyFragments } from "./fragments/toolPolicy";
import { subagentFragments } from "./fragments/subagents";
import { conditionalFragments } from "./fragments/conditional";
import { memoryFragments } from "./fragments/memory";

/** All prompt fragments contributed by the default mode plugin:
 *  mode-tagged identity anchor, the shared clusters, the default-mode
 *  clusters (task discipline, tool policy, subagent delegation), the
 *  trait-conditional cluster, and the shared memory discipline. */
export const defaultModeFragments: PromptFragment[] = [
  ...identityFragments,
  ...communicationFragments,
  ...safetyFragments,
  ...taskDisciplineFragments,
  ...toolPolicyFragments,
  ...subagentFragments,
  ...conditionalFragments,
  ...memoryFragments,
];

/** Default agent mode plugin — registers the "default" mode and contributes its
 *  prompt fragments (shared + mode-specific + trait-conditional). The plugin
 *  name must equal the registered agent id: the mode switcher lists modes by
 *  the staging manifest id, while the session resolves the prompt by the
 *  registered id — a mismatch makes the selected mode silently fall back. */
export const DefaultAgentModePlugin = {
  name: "default",
  apply(ctx: Context) {
    ctx.agents.register({ id: "default", title: "Default" });
    for (const fragment of defaultModeFragments) ctx.systemPrompt.registerFragment(fragment);
  },
};
export default DefaultAgentModePlugin;
