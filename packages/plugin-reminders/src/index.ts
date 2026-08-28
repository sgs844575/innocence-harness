// Reminders plugin (B3): injects contextual <system-reminder> envelopes as
// additional text parts on the message side — the system prompt is never
// touched (caching discipline). Factory form (same staged shape as the
// creation mode plugin) so the host session composition supplies the
// permission-mode getter instead of the plugin reading host settings itself.
import type { Context } from "@innocenceharness/kernel";
// Type-only import: also pulls the `ctx.session` service augmentation of
// harness-session into this compilation, mirroring plugin-skills.
import type {
  Message,
  MessageProcessorContext,
  ToolCallPart,
} from "@innocenceharness/harness-session";
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

/** Tool name of the session's todo list tool (whole-replace semantics). */
const TODO_TOOL_NAME = "TodoWrite";
/**
 * Recency window: a list counts as stale once five messages have accumulated
 * after its last refresh. Histories shorter than the window simply hold all
 * their messages inside it, so any refresh still inside such a history is
 * always "recent".
 */
const TODO_STALE_WINDOW = 5;

/**
 * Derives the todo-freshness state from the session-local history view. The
 * most recent list-tool call wins (each call whole-replaces the list);
 * malformed args — missing, non-array, or empty todos — count as "no list"
 * and never arm the reminder. A list is stale only when it holds an entry
 * not marked completed AND its last refresh falls outside the recency
 * window (a refresh inside the window means the model just touched it, and
 * nagging would only add noise).
 *
 * Child sessions are naturally safe without an owner-session gate: the
 * history accessor reflects the child's own ledger, which never contains
 * the parent's list-tool calls, so the derivation yields "no list" there.
 */
function todoListStale(history: readonly Message[]): boolean {
  let refreshIndex = -1;
  let todos: unknown;
  for (let i = history.length - 1; i >= 0; i--) {
    const part = history[i].parts.find(
      (p): p is ToolCallPart => p.type === "toolCall" && p.toolName === TODO_TOOL_NAME,
    );
    if (part) {
      refreshIndex = i;
      todos = part.args?.todos;
      break;
    }
  }
  if (refreshIndex < 0 || !Array.isArray(todos) || todos.length === 0) return false;
  const hasOpenEntry = todos.some((entry) => entry?.status !== "completed");
  if (!hasOpenEntry) return false;
  return history.length - 1 - refreshIndex >= TODO_STALE_WINDOW;
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
 *
 * Child sessions inherit the parent's identical processor instances (the
 * subagent spawner passes `inherit.processors` into the child session
 * factory), and their runs pass through the same processUserInput pipeline —
 * so instance-scoped state alone is NOT session-scoped. The first-seen
 * session id below therefore gates session-scoped reminders: the plan
 * reminder only fires in the session that first used this instance, never
 * in an inherited child session (whose contract is "return findings", not
 * "present a plan for approval"). The provider-context reminder applies to
 * child turns as well (their requests are served by the same provider), and
 * the trust boundary is already consumed by the parent's first turn. The
 * todo-freshness reminder needs no such gate: it derives from the turn's
 * own history accessor, and a child session's ledger holds no list-tool
 * calls, so it stays unarmed there by construction.
 */
export function createRemindersPlugin(options: RemindersPluginOptions): RemindersPlugin {
  return {
    name: "reminders",
    apply(ctx) {
      let firstTurn = true;
      let firstSessionId: string | undefined;
      ctx.session.registerProcessor({
        name: "reminders",
        order: REMINDERS_PROCESSOR_ORDER,
        async process(message: Message, context: MessageProcessorContext): Promise<Message> {
          firstSessionId ??= context.scope.sessionId;
          const state: ReminderState = {
            provider: { id: context.provider?.id ?? "unknown" },
            permissionMode: options.getPermissionMode(),
            firstTurn,
            ownerSession: context.scope.sessionId === firstSessionId,
            // History is an optional context member: hosts and fakes that
            // supply no accessor simply leave the list reminder unarmed
            // (undefined → template off, and no read is attempted).
            todoStale: context.history ? todoListStale(context.history()) : undefined,
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
