// Plan submission tool (batch 4A task 2): the model presents a finished plan
// through this tool. In plan mode the engine routes the plan-kind resource
// straight to the user ask — submitting the plan IS the approval prompt —
// and the planflow listener turns that verdict into the engine's plan
// approval plus the unlock/reject reminders.
import { type Tool } from "@innocenceharness/harness-tools";

export const PLAN_SUBMIT_TOOL_NAME = "plan_submit";

/** Parses and validates the raw submission args with the complete payload in
 * diagnostics so validation failures remain directly reproducible. */
function requirePlan(args: Record<string, unknown>): { plan: string; summary?: string } {
  const received = JSON.stringify(args);
  if (typeof args.plan !== "string" || args.plan.trim().length === 0) {
    throw new Error(`缺少必填参数 plan（非空字符串）；收到 ${received}`);
  }
  if (args.summary !== undefined && typeof args.summary !== "string") {
    throw new Error(`可选参数 summary 必须是字符串；收到 ${received}`);
  }
  return args.summary === undefined ? { plan: args.plan } : { plan: args.plan, summary: args.summary };
}

/** English confirmation returned on every accepted submission. Mode-neutral:
 *  it describes what approval and rejection mean without presuming the
 *  session asks for confirmation (auto/full modes allow without asking).
 *  Adapted from upstream plan-mode reminder material; restructured rewrite,
 *  never verbatim; neutral terminology only. Exported for text-discipline
 *  tests. */
export const SUBMIT_CONFIRMATION = [
  "The plan text is recorded and presented for review.",
  "Where the session asks for confirmation, the user's approval opens the",
  "implementation stage and every write operation still passes through the",
  "ordinary permission checkpoints one by one. A declined submission can",
  "be reworked with the feedback and submitted again.",
].join(" ");

/**
 * Session-scoped plan submission tool. The full plan text lives only in the
 * transcript through the complete tool-call args
 * — nothing is ever written to the workspace.
 */
export const planSubmitTool: Tool = {
  name: PLAN_SUBMIT_TOOL_NAME,
  description:
    "提交计划全文供用户在权限卡上审批：批准后进入实现阶段，被拒时按反馈修订后重新提交。",
  // 纯会话状态：计划全文只留档 transcript，无工作区/进程/网络副作用——
  // readOnly 是"无外部副作用"的诚实分类；plan 档内本资源经引擎特例
  // （kind plan 跳过 plan 短路）直达 ask 级权限卡，用户在该卡上的回答
  // 即计划的批准/拒绝（批准面）。
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
  async execute(args) {
    requirePlan(args);
    return { content: SUBMIT_CONFIRMATION };
  },
};
