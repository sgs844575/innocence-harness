import type { Context } from "@innocenceharness/kernel";
import type { PromptFragment } from "@innocenceharness/harness-system-prompt";
import { identityFragments } from "./fragments/identity";
import { communicationFragments } from "./fragments/communication";
import { safetyFragments } from "./fragments/safety";

/** All prompt fragments contributed by the default mode plugin:
 *  mode-tagged identity anchor plus the shared clusters. */
export const defaultModeFragments: PromptFragment[] = [
  ...identityFragments,
  ...communicationFragments,
  ...safetyFragments,
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
