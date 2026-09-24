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
import { reminderTemplates, type ReminderState, type UsageSummary } from "./templates";

export type { ReminderState, ReminderTemplate, UsageSummary } from "./templates";
export { reminderTemplates } from "./templates";

export interface RemindersPluginOptions {
  /** Reads the current permission mode; called once per processed turn. */
  getPermissionMode: () => string;
  /**
   * Reads the session's cumulative token usage (host-maintained accumulator
   * or store derivation); absent means the composition has no usage source
   * and the usage-level reminder stays unarmed. Called once per processed
   * owner-session turn.
   */
  getSessionUsage?: () => UsageSummary | undefined;
  /**
   * True when this session continues from previously stored history (the
   * host rebuilt the session with a transcript seed); absent means no
   * continuation signal and the reminder stays unarmed.
   */
  isContinuationSession?: () => boolean;
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

/**
 * Usage-level crossing rule: the reminder fires the first time cumulative
 * total tokens reach the threshold, then again each time the cumulative
 * total grows by half over the last injected level.
 */
const USAGE_FIRST_THRESHOLD_TOKENS = 100_000;
const USAGE_GROWTH_FACTOR = 1.5;

/** Wraps one rendered template body in the shared reminder envelope. */
function envelope(body: string): string {
  return `<system-reminder>\n${body}\n</system-reminder>`;
}

/** Tool name of the session's todo list tool (whole-replace semantics). */
const TODO_TOOL_NAME = "TodoWrite";
/**
 * Recency window shared by both list reminders. A list counts as stale once
 * three messages have accumulated after its last refresh — the workflow
 * contract is item-by-item updates (start one → in_progress, finish one →
 * completed immediately), so two tool round-trips of silence is already
 * drift and nagging must arrive on the next turn, not several turns later.
 */
const TODO_STALE_WINDOW = 3;
/**
 * Throttle between consecutive start-of-task reminders inside one open-list
 * absence period: once fired, the next re-arm waits six more messages, so a
 * Q&A stretch is never nagged every turn while a genuinely new task a few
 * messages later still gets its reminder.
 */
const TODO_ABSENT_REARM_WINDOW = 6;

/** The latest list-tool call a history holds, with its open-entry state. */
interface TodoListSnapshot {
  /** Index of the message carrying the most recent list-tool call. */
  refreshIndex: number;
  /** True when the latest list holds at least one non-completed entry. */
  hasOpenEntry: boolean;
}

/**
 * Derives the todo-list state from the session-local history view. The most
 * recent list-tool call wins (each call whole-replaces the list); malformed
 * args — missing, non-array, or empty todos — count as "no list" (null).
 *
 * Child sessions are naturally safe without an owner-session gate: the
 * history accessor reflects the child's own ledger, which never contains
 * the parent's list-tool calls, so the derivation yields null there.
 */
function todoListSnapshot(history: readonly Message[]): TodoListSnapshot | null {
  for (let i = history.length - 1; i >= 0; i--) {
    const part = history[i].parts.find(
      (p): p is ToolCallPart => p.type === "toolCall" && p.toolName === TODO_TOOL_NAME,
    );
    if (!part) continue;
    const todos = part.args?.todos;
    if (!Array.isArray(todos) || todos.length === 0) return null;
    return {
      refreshIndex: i,
      hasOpenEntry: todos.some((entry) => (entry as { status?: string })?.status !== "completed"),
    };
  }
  return null;
}

/**
 * Stale-open rule for the freshness reminder: an open list whose last
 * refresh falls outside the recency window (a refresh inside the window
 * means the model just touched it, and nagging would only add noise).
 */
function todoListStale(history: readonly Message[]): boolean {
  const list = todoListSnapshot(history);
  if (list === null || !list.hasOpenEntry) return false;
  return history.length - 1 - list.refreshIndex >= TODO_STALE_WINDOW;
}

/**
 * Start-of-task rule for the workflow reminder: the turn is NOT the first
 * (the first turn already carries the system-prompt workflow discipline)
 * and no open list exists — either the session never built one, or the
 * latest list is fully completed/closed — while enough messages have passed
 * since the list went away (or since the session began) for a genuinely new
 * task to be starting.
 */
function todoWorkflowAbsent(history: readonly Message[]): boolean {
  const list = todoListSnapshot(history);
  if (list !== null && list.hasOpenEntry) return false; // open list → freshness owns the nag
  // Absence = no valid list at all, or the latest one fully completed (the
  // task it tracked has wrapped up). Either way the re-arm clock counts from
  // the last list-tool call; a never-used session counts from its start.
  const lastCall =
    list !== null ? list.refreshIndex : lastSeenListCallIndex(history);
  return lastCall !== null
    ? history.length - 1 - lastCall >= TODO_STALE_WINDOW
    : history.length >= TODO_STALE_WINDOW;
}

/** Index of the LAST message carrying any list-tool call (null = none). */
function lastSeenListCallIndex(history: readonly Message[]): number | null {
  for (let i = history.length - 1; i >= 0; i--) {
    if (
      history[i].parts.some(
        (p): p is ToolCallPart => p.type === "toolCall" && p.toolName === TODO_TOOL_NAME,
      )
    ) {
      return i;
    }
  }
  return null;
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
 * calls, so it stays unarmed there by construction. The todo workflow-start
 * reminder IS owner-gated: child contracts already carry the workflow
 * discipline on the thread-notes channel, and the throttle budget belongs
 * to the parent's absence period.
 */
export function createRemindersPlugin(options: RemindersPluginOptions): RemindersPlugin {
  return {
    name: "reminders",
    apply(ctx) {
      let firstTurn = true;
      let firstSessionId: string | undefined;
      // Cumulative-total level the usage reminder last fired at; undefined
      // until the first threshold crossing. Lives in this closure (session
      // composition scope) and only owner-session turns read or advance it,
      // so inherited child sessions neither see the reminder nor consume
      // the watermark.
      let usageWatermark: number | undefined;
      // Start-of-task reminder throttle: history length at the last fire.
      // Owner-session turns only, so child sessions never consume the
      // re-arm budget of the parent's absence period.
      let todoAbsentRemindedAt: number | undefined;
      ctx.session.registerProcessor({
        name: "reminders",
        order: REMINDERS_PROCESSOR_ORDER,
        async process(message: Message, context: MessageProcessorContext): Promise<Message> {
          firstSessionId ??= context.scope.sessionId;
          const ownerSession = context.scope.sessionId === firstSessionId;
          const usage = ownerSession ? options.getSessionUsage?.() : undefined;
          const totalTokens = usage?.totalTokens ?? 0;
          const usageCrossed =
            usage !== undefined &&
            totalTokens > 0 &&
            (usageWatermark === undefined
              ? totalTokens >= USAGE_FIRST_THRESHOLD_TOKENS
              : totalTokens >= usageWatermark * USAGE_GROWTH_FACTOR);
          if (usageCrossed) usageWatermark = totalTokens;
          const history = context.history?.();
          // Start-of-task (workflow) reminder: a non-first owner turn with
          // no open list arms once per absence period; the freshness
          // reminder below needs no gate (a child ledger holds no list
          // calls of its own).
          let todoWorkflowStart: boolean | undefined;
          if (ownerSession && !firstTurn && history !== undefined) {
            todoWorkflowStart =
              todoWorkflowAbsent(history) &&
              (todoAbsentRemindedAt === undefined ||
                history.length - todoAbsentRemindedAt >= TODO_ABSENT_REARM_WINDOW);
            if (todoWorkflowStart) todoAbsentRemindedAt = history.length;
          }
          const state: ReminderState = {
            provider: { id: context.provider?.id ?? "unknown" },
            permissionMode: options.getPermissionMode(),
            firstTurn,
            ownerSession,
            // History is an optional context member: hosts and fakes that
            // supply no accessor simply leave the list reminders unarmed
            // (undefined → template off, and no read is attempted).
            todoStale: history ? todoListStale(history) : undefined,
            ...(todoWorkflowStart ? { todoWorkflowStart: true } : {}),
            ...(usageCrossed ? { usageLevel: usage } : {}),
            ...(ownerSession && options.isContinuationSession?.() ? { continuation: true } : {}),
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
