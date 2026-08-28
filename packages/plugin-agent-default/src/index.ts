import type { Context } from "@innocenceharness/kernel";
import { identityFragments } from "./fragments/identity";

/** Default agent mode plugin — registers the "default" mode and contributes its
 *  prompt fragments (shared + mode-specific + trait-conditional). */
export const DefaultAgentModePlugin = {
  name: "agent-default",
  apply(ctx: Context) {
    ctx.agents.register({ id: "default", title: "Default" });
    for (const fragment of identityFragments) ctx.systemPrompt.registerFragment(fragment);
  },
};
export default DefaultAgentModePlugin;
