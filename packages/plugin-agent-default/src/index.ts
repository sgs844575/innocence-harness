import type { Context } from "@innocenceharness/kernel";
import type { PromptFragment } from "@innocenceharness/harness-system-prompt";
import { identityFragments } from "./fragments/identity";
import { communicationFragments } from "./fragments/communication";
import { safetyFragments } from "./fragments/safety";
import { taskDisciplineFragments } from "./fragments/taskDiscipline";
import { toolPolicyFragments } from "./fragments/toolPolicy";
import { subagentFragments } from "./fragments/subagents";

/** All prompt fragments contributed by the default mode plugin:
 *  mode-tagged identity anchor, the shared clusters, and the default-mode
 *  clusters (task discipline, tool policy, subagent delegation). */
export const defaultModeFragments: PromptFragment[] = [
  ...identityFragments,
  ...communicationFragments,
  ...safetyFragments,
  ...taskDisciplineFragments,
  ...toolPolicyFragments,
  ...subagentFragments,
];

/** Default agent mode plugin — registers the "default" mode and contributes its
 *  prompt fragments (shared + mode-specific + trait-conditional). */
export const DefaultAgentModePlugin = {
  name: "agent-default",
  apply(ctx: Context) {
    ctx.agents.register({ id: "default", title: "Default" });
    for (const fragment of defaultModeFragments) ctx.systemPrompt.registerFragment(fragment);
  },
};
export default DefaultAgentModePlugin;
