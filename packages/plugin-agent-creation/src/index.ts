import type { Context } from "@innocenceharness/kernel";
import type { PromptFragment } from "@innocenceharness/harness-system-prompt";
import { createInstallUserPluginTool } from "./installUserPlugin";
import { personaFragments } from "./fragments/persona";
import { workflowFragments } from "./fragments/workflow";
import { knowledgeFragments } from "./fragments/knowledge";

/** All prompt fragments contributed by the creation mode plugin:
 *  mode-tagged persona, workflow, and knowledge clusters. Shared clusters
 *  (communication, safety) come from the default mode plugin without a
 *  modes tag, so they load for creation too. */
export const creationFragments: PromptFragment[] = [
  ...personaFragments,
  ...workflowFragments,
  ...knowledgeFragments,
];

/**
 * Creation agent mode plugin factory — registers the "creation" mode, its
 * prompt fragments, and the install_user_plugin tool bound to the user
 * plugin root. Factory form so the session composition wiring can pass the
 * host-resolved user root instead of importing host paths here.
 */
export function createCreationPlugin(options: { userRoot: string }) {
  return {
    name: "agent-creation",
    apply(ctx: Context) {
      ctx.agents.register({ id: "creation", title: "Creation" });
      for (const fragment of creationFragments) ctx.systemPrompt.registerFragment(fragment);
      ctx.tools.register(createInstallUserPluginTool(options));
    },
  };
}
export default createCreationPlugin;
