// Planflow plugin (batch 4A task 2): closes the plan submission loop —
// registers the plan_submit tool, listens for the user's verdict on its
// permission ask (approving the engine's plan state), and injects the
// unlock/reject reminders as appended text parts on the next processed
// user message. Static plugin form (no host configuration needs), so the
// default export is the plugin object itself.
import type { Context } from "@innocenceharness/kernel";
// Type-only imports also pull the needed Context service augmentations into
// this compilation: "harness/event" on Events plus ctx.session
// (harness-session) and ctx.permissions (harness-permissions), mirroring
// the plugin-reminders/plugin-agent-plan precedent.
import type { Message, MessageProcessor } from "@innocenceharness/harness-session";
import type {} from "@innocenceharness/harness-permissions";
import { PLAN_SUBMIT_TOOL_NAME, planSubmitTool } from "./planSubmit";

export { planSubmitTool, PLAN_SUBMIT_TOOL_NAME, SUBMIT_CONFIRMATION } from "./planSubmit";

/** Pipeline position: right after the reminders processor (900), so plan
 *  flow envelopes append after — never inside — other reminder envelopes. */
export const PLANFLOW_PROCESSOR_ORDER = 910;

/** Verdict-driven state machine: pending until the user answers the plan
 *  submission ask, then approved/denied, then consumed once the reminder
 *  parts have been appended (a later verdict re-arms injection). */
type PlanFlowState = "pending" | "approved" | "denied" | "consumed";

/** One reminder body plus its <system-reminder> envelope form. */
export interface PlanReminder {
  readonly body: string;
  readonly enveloped: string;
}

/** Wraps one rendered body in the shared reminder envelope. */
function envelope(body: string): string {
  return `<system-reminder>\n${body}\n</system-reminder>`;
}

function reminder(body: string): PlanReminder {
  return { body, enveloped: envelope(body) };
}

/**
 * Reminders injected after approval. English adaptations of the upstream
 * plan-approved / exited-plan-mode / approval-enforcement / subagent and
 * plan-file-reference material; restructured rewrites, never verbatim;
 * neutral terminology only.
 */
export const APPROVED_REMINDERS: readonly [PlanReminder, PlanReminder] = [
  reminder(
    [
      "The plan received user approval: the implementation stage is open.",
      "Write operations still pass through the ordinary permission",
      "checkpoints individually, and delegated subagents stay on read-only",
      "research duty for this stage.",
    ].join(" "),
  ),
  reminder(
    [
      "The full plan text is kept in this session's record.",
      "Point at that record in later steps instead of restating the plan's",
      "contents.",
    ].join(" "),
  ),
];

/** Reminder injected after rejection (inverse of the exited/unlocked
 *  wording): revise per the feedback, then submit again. */
export const DENIED_REMINDER: PlanReminder = reminder(
  [
    "The plan was declined.",
    "Rework it according to the user's feedback, then submit the revised",
    "version for another review.",
  ].join(" "),
);

/** Plan flow plugin — wires the tool, the verdict listener and the reminder
 *  processor onto one session's kernel context. */
export const PlanflowPlugin = {
  name: "planflow" as const,
  apply(ctx: Context) {
    let state: PlanFlowState = "pending";

    ctx.tools.register(planSubmitTool);

    // Verdict listener. Measured event shape (harness-session events.ts and
    // the loop's emission site): a permission event carries
    // {type, id, toolName, resolution{decision, via, reason}} and NO resource
    // field, so the plan-kind resource of this plugin is identified by the
    // tool name. Only ask-stage resolutions are user verdicts: the engine
    // routes the plan-kind submission resource past the plan-mode
    // short-circuits straight to the ask stage, so the user's answer on that
    // ask IS the plan's approval or rejection — engine auto-decisions
    // (planReadOnly allow / planMode deny) for other tools must never flip
    // this state.
    //
    // The subscription is an effect of this plugin's fiber (EventBus kernel
    // contract), so it disappears when the fiber unloads — no manual
    // cleanup path exists or is needed here.
    ctx.on("harness/event", (event) => {
      if (event.type !== "permission" || event.toolName !== PLAN_SUBMIT_TOOL_NAME) return;
      // ServiceTable 契约：permissions 成员仅在权限脊柱 fiber 存活期内可达。
      // 缺席窗口（拆卸竞态、无权限脊柱的宿主）内到达的决议整体丢弃——
      // 不崩溃，也不注入无引擎背书的"已批准"提醒。
      const permissions = ctx.permissions;
      if (!permissions) return;
      if (event.resolution.via !== "ask") return;
      if (event.resolution.decision === "allow") {
        // Unlock writes in the engine (no-op outside plan mode by design);
        // the closure state only drives the reminders below.
        permissions.approvePlan();
        state = "approved";
      } else {
        state = "denied";
      }
    });

    ctx.session.registerProcessor({
      name: "planflow",
      order: PLANFLOW_PROCESSOR_ORDER,
      async process(message: Message): Promise<Message> {
        if (state === "approved") {
          // Append-only: existing parts are never rewritten (the session
          // contract — the envelopes become part of the outbound turn), and
          // the pair is injected exactly once per verdict.
          message.parts.push(
            { type: "text", text: APPROVED_REMINDERS[0].enveloped },
            { type: "text", text: APPROVED_REMINDERS[1].enveloped },
          );
          state = "consumed";
        } else if (state === "denied") {
          message.parts.push({ type: "text", text: DENIED_REMINDER.enveloped });
          state = "consumed";
        }
        return message;
      },
    } satisfies MessageProcessor);
  },
};

// Distribution default (kernel-loader unwrapExports convention): the plugin
// object itself, so a disk-loaded module resolves to the static plugin hosts
// mount directly.
export default PlanflowPlugin;
