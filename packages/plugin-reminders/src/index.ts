// Reminders plugin (B3): injects contextual <system-reminder> envelopes as
// additional text parts on the message side — the system prompt is never
// touched (caching discipline). Factory form (same staged shape as the
// creation mode plugin) so the host session composition supplies the
// permission-mode getter instead of the plugin reading host settings itself.
import type { Context } from "@innocenceharness/kernel";
// Type-only import: also pulls the `ctx.session` service augmentation of
// harness-session into this compilation, mirroring plugin-skills.
import type { Message, MessageProcessorContext } from "@innocenceharness/harness-session";
import { reminderTemplates, type ReminderState } from "./templates";

export type { ReminderState, ReminderTemplate } from "./templates";
export { reminderTemplates } from "./templates";

export interface RemindersPluginOptions {
  /** Reads the current permission mode; called once per processed turn. */
  getPermissionMode: () => string;
}

export interface RemindersPlugin {
  readonly name: "reminders";
  apply(ctx: Context): void;
}

/**
 * Pipeline position: after the conventionally-numbered host processors (0)
 * and the early skill-expansion pass (-1000), so reminders append to the
 * final outbound user message rather than to input other processors still
 * rewrite.
 */
const REMINDERS_PROCESSOR_ORDER = 900;

/** Wraps one rendered template body in the shared reminder envelope. */
function envelope(body: string): string {
  return `<system-reminder>\n${body}\n</system-reminder>`;
}

/**
 * Creates the reminders plugin for one session. `apply` registers a single
 * message processor ("reminders", order 900) that appends one text part per
 * matching template to the message's own parts array — existing parts are
 * never rewritten, only appended after (the session contract: the returned
 * message is the caller's object, and the appended envelopes become part of
 * the outbound turn and its stored history). The first-turn flag lives in
 * this closure, and the plugin instance is created per session composition
 * (host `pluginsForSession`), so the flag is session-scoped by construction.
 */
export function createRemindersPlugin(options: RemindersPluginOptions): RemindersPlugin {
  return {
    name: "reminders",
    apply(ctx) {
      let firstTurn = true;
      ctx.session.registerProcessor({
        name: "reminders",
        order: REMINDERS_PROCESSOR_ORDER,
        async process(message: Message, context: MessageProcessorContext): Promise<Message> {
          const state: ReminderState = {
            provider: { id: context.provider?.id ?? "unknown" },
            permissionMode: options.getPermissionMode(),
            firstTurn,
          };
          firstTurn = false;
          for (const template of reminderTemplates) {
            if (!template.when(state)) continue;
            message.parts.push({ type: "text", text: envelope(template.render(state)) });
          }
          return message;
        },
      });
    },
  };
}

// Distribution default (kernel-loader unwrapExports convention): the factory,
// so a disk-loaded module resolves to the single entry point hosts configure.
export default createRemindersPlugin;
