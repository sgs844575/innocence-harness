// Ask plugin: the ask_user structured-question tool. Factory form (same staged
// shape as the team plugin) so the host session composition injects the ask
// port — the plugin owns no UI/IPC knowledge; tests pass fakes. apply also
// registers the session allow rule that keeps the permission pipeline from
// double-prompting (an "allow ask_user?" card before every question card).
import type { Context } from "@innocenceharness/kernel";
// The tools module imports harness-tools, which also pulls its Context
// service augmentation (ctx.tools) into this compilation; harness-permissions
// contributes the PermissionsService shape read defensively below.
import { ASK_USER_ALLOW_RULE, createAskUserTool, type AskUserPort } from "./askUser";
import type { PermissionsService } from "@innocenceharness/harness-permissions";

export * from "./askUser";

export interface AskPluginOptions {
  /** Ask port bound to the asking session's identity by the host. */
  askUser: AskUserPort;
}

export interface AskPlugin {
  readonly name: "ask";
  apply(ctx: Context): void;
}

/** Creates the ask plugin for one session: registers the ask_user tool. */
export function createAskPlugin(options: AskPluginOptions): AskPlugin {
  return {
    name: "ask",
    apply(ctx: Context) {
      ctx.tools.register(createAskUserTool(options));
      // The permissions spine service is live only while its fiber is active
      // (it loads before capability plugins); bare kernel compositions
      // without it simply skip the rule — auto/full/plan modes never prompt
      // for a read-only tool anyway.
      const permissions = (ctx as { permissions?: PermissionsService }).permissions;
      permissions?.registerPolicyRule(ASK_USER_ALLOW_RULE);
    },
  };
}

// Distribution default (kernel-loader unwrapExports convention): the factory,
// so a disk-loaded module resolves to the single entry point hosts configure.
export default createAskPlugin;
