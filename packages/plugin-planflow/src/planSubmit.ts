// Plan submission tool (batch 4A task 2): the model presents a finished plan
// through this tool; the user's verdict arrives later on the permission ask
// of the very submission, and the planflow listener turns that verdict into
// the engine's plan approval plus the unlock/reject reminders.
import { sha256Hex, type Tool } from "@innocenceharness/harness-tools";

export const PLAN_SUBMIT_TOOL_NAME = "plan_submit";

/**
 * Parses and validates the raw submission args. Throws naming the failing
 * field (never its content) — tool errors enter history/audit unredacted.
 */
function requirePlan(args: Record<string, unknown>): { plan: string; summary?: string } {
  if (typeof args.plan !== "string" || args.plan.trim().length === 0) {
    throw new Error("缺少必填参数 plan（非空字符串）");
  }
  if (args.summary !== undefined && typeof args.summary !== "string") {
    throw new Error("可选参数 summary 必须是字符串");
  }
  return args.summary === undefined ? { plan: args.plan } : { plan: args.plan, summary: args.summary };
}

/** English confirmation returned on every accepted submission. Adapted from
 *  upstream plan-mode reminder material; restructured rewrite, never
 *  verbatim; neutral terminology only. Exported for text-discipline tests. */
export const SUBMIT_CONFIRMATION = [
  "The plan text is recorded and now sits before the user for review.",
  "Hold off on changes until the decision arrives on the permission prompt:",
  "approval opens the implementation stage, and every write operation still",
  "passes through the ordinary permission checkpoints one by one.",
  "If the submission is declined, rework the plan using the feedback and",
  "submit it again.",
].join(" ");

/**
 * Session-scoped plan submission tool. The full plan text lives only in the
 * transcript through persisted tool-call args ({summary?, plan, planSha256})
 * — nothing is ever written to the workspace.
 */
export const planSubmitTool: Tool = {
  name: PLAN_SUBMIT_TOOL_NAME,
  description:
    "提交计划全文供用户在权限卡上审批：批准后进入实现阶段，被拒时按反馈修订后重新提交。",
  // 纯会话状态：计划全文只留档 transcript，无工作区/进程/网络副作用——
  // 按只读分类（plan 档研究期可自由调用，无需先解锁）；资源 submit/plan/
  // session 描述的是"呈报一份计划"这一逻辑动作，批准面是它在 ask 级
  // 权限卡上的用户决议。
  readOnly: true,
  sideEffect: "none",
  parameters: {
    type: "object",
    properties: {
      plan: { type: "string", description: "计划全文（完整内容，不是摘要）" },
      summary: { type: "string", description: "一句话计划摘要（可选，权限卡展示用）" },
    },
    required: ["plan"],
  },
  async validateArgs(args) {
    requirePlan(args);
  },
  permissionResource() {
    // 会话级计划呈报：scope 恒为 session（不携带计划内容或路径等原始值）。
    return { action: "submit", kind: "plan", scope: "session" };
  },
  persistArgs(args) {
    // 计划全文由模型撰写、面向 transcript 留档（后续引用而非重述的载体）；
    // sha256Hex 供会话内的计划变更检测，summary 仅在提供时持久化。
    const { plan, summary } = requirePlan(args);
    const persisted: Record<string, unknown> = { plan, planSha256: sha256Hex(plan) };
    if (summary !== undefined) persisted.summary = summary;
    return persisted;
  },
  async execute(args) {
    requirePlan(args);
    return { content: SUBMIT_CONFIRMATION };
  },
};
