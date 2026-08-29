// Team plugin (batch 4E task 1): named-teammate collaboration. Factory form
// (same staged shape as the creation/reminders/memory/hooks plugins) so the
// host session composition injects the sendToTeammate delivery port — the
// plugin owns no routing knowledge; tests pass fakes.
import type { Context } from "@innocenceharness/kernel";
// The tools module imports harness-tools, which also pulls its Context
// service augmentation (ctx.tools) into this compilation.
import { createSendMessageTool, type SendToTeammatePort } from "./sendMessage";

export * from "./sendMessage";

export interface TeamPluginOptions {
  /** Delivery port bound to the sending session's identity by the host. */
  sendToTeammate: SendToTeammatePort;
}

export interface TeamPlugin {
  readonly name: "team";
  apply(ctx: Context): void;
}

/** Creates the team plugin for one session: registers the send_message tool. */
export function createTeamPlugin(options: TeamPluginOptions): TeamPlugin {
  return {
    name: "team",
    apply(ctx: Context) {
      ctx.tools.register(createSendMessageTool(options));
    },
  };
}

// Distribution default (kernel-loader unwrapExports convention): the factory,
// so a disk-loaded module resolves to the single entry point hosts configure.
export default createTeamPlugin;
