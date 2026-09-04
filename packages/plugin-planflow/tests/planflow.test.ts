// Planflow plugin tests (batch 4A task 2): the plan_submit tool contract,
// the permission-event listener (real kernel Context + manual event emits),
// the unlock/reject reminder processor states, and one end-to-end pass.
import { describe, expect, it } from "vitest";
import { Context } from "@innocenceharness/kernel";
import {
  createPermissionsService,
  PermissionEngine,
  type PermissionRequest,
  type PermissionResolution,
  type PermissionsService,
} from "@innocenceharness/harness-permissions";
import { ToolsPlugin } from "@innocenceharness/harness-tools";
import type { Message, MessageProcessor } from "@innocenceharness/harness-session";
import {
  APPROVAL_BASE_BODY,
  APPROVAL_PLAN_DUTY_BODY,
  DENIED_REMINDER,
  PLAN_RECORD_BODY,
  PlanflowPlugin,
  PLANFLOW_PROCESSOR_ORDER,
  PLAN_SUBMIT_TOOL_NAME,
  approvedReminderEnvelopes,
  planSubmitTool,
} from "../src";

function makeMessage(text: string): Message {
  return { role: "user", parts: [{ type: "text", text }] };
}

function makeProcessorContext(sessionId = "s1"): never {
  return {
    signal: new AbortController().signal,
    provider: { id: "test" },
    scope: { sessionId },
  } as never;
}

const textsOf = (m: Message) =>
  m.parts.filter((p): p is Extract<typeof p, { type: "text" }> => p.type === "text").map((p) => p.text);

interface Mounted {
  ctx: Context;
  fiber: Awaited<ReturnType<Context["plugin"]>>;
  approveCalls: { count: number };
  mode: { value: string };
  processors: MessageProcessor[];
}

/** Mounts the plugin on a real kernel Context: the real ToolsPlugin gate,
 *  a recording fake permissions service (mutable engine mode), a capturing
 *  fake session service. */
async function mountPlanflow(): Promise<Mounted> {
  const ctx = new Context();
  const approveCalls = { count: 0 };
  const mode = { value: "plan" };
  const processors: MessageProcessor[] = [];
  await ctx.plugin(ToolsPlugin);
  ctx.provide("permissions", {
    approvePlan: () => {
      approveCalls.count += 1;
    },
    engine: { getMode: () => mode.value },
  } as unknown as PermissionsService);
  ctx.provide("session", {
    registerProcessor: (p: MessageProcessor) => processors.push(p),
  });
  const fiber = await ctx.plugin(PlanflowPlugin);
  return { ctx, fiber, approveCalls, mode, processors };
}

function emitPermission(
  ctx: Context,
  decision: "allow" | "deny",
  via: PermissionResolution["via"] = "ask",
  toolName: string = PLAN_SUBMIT_TOOL_NAME,
): void {
  ctx.emit("harness/event", {
    type: "permission",
    id: "perm-1",
    toolName,
    resolution: { decision, via, reason: "test resolution" },
  });
}

const toolCtx = () =>
  ({
    workspaceRoot: "D:/work",
    signal: new AbortController().signal,
    log: () => {},
    scope: { sessionId: "s1", invocationId: "inv-1" },
  }) as never;

describe("plan_submit tool", () => {
  it("declares the submission shape: plan required, summary optional, Chinese description", () => {
    expect(planSubmitTool.name).toBe(PLAN_SUBMIT_TOOL_NAME);
    expect(PLAN_SUBMIT_TOOL_NAME).toBe("plan_submit");
    expect(planSubmitTool.parameters).toMatchObject({
      type: "object",
      required: ["plan"],
      properties: { plan: { type: "string" }, summary: { type: "string" } },
    });
    // 本仓工具描述中文风格（LLM 面 description 沿用仓库语言约定）。
    expect(planSubmitTool.description).toMatch(/[\u4e00-\u9fff]/);
    // 会话内逻辑动作、无外部副作用：研究期可调用，批准面是 ask 级决议。
    expect(planSubmitTool.readOnly).toBe(true);
    expect(planSubmitTool.sideEffect).toBe("none");
  });

  it("validates plan as a non-empty string and summary as an optional string", async () => {
    await expect(planSubmitTool.validateArgs?.({})).rejects.toThrow(/plan/);
    await expect(planSubmitTool.validateArgs?.({ plan: 42 })).rejects.toThrow(/plan/);
    await expect(planSubmitTool.validateArgs?.({ plan: "" })).rejects.toThrow(/plan/);
    await expect(planSubmitTool.validateArgs?.({ plan: "   \n\t" })).rejects.toThrow(/plan/);
    await expect(planSubmitTool.validateArgs?.({ plan: "step 1" })).resolves.toBeUndefined();
    await expect(planSubmitTool.validateArgs?.({ plan: "step 1", summary: 7 })).rejects.toThrow(/summary/);
    await expect(planSubmitTool.validateArgs?.({ plan: "step 1", summary: "one line" })).resolves.toBeUndefined();
    // Validation errors preserve the complete invalid value for diagnostics.
    await expect(
      planSubmitTool.validateArgs?.({ plan: "", summary: "SECRET-PLAN-VALUE" }),
    ).rejects.toThrow(/SECRET-PLAN-VALUE/);
  });

  it("maps every call to the canonical session-level plan submission resource", () => {
    expect(planSubmitTool.permissionResource({ plan: "step 1" }, toolCtx())).toEqual({
      action: "submit",
      kind: "plan",
      scope: "session",
    });
    expect(planSubmitTool.permissionResource({ plan: "other", summary: "s" }, toolCtx())).toEqual({
      action: "submit",
      kind: "plan",
      scope: "session",
    });
  });

  it("executes into a mode-neutral English confirmation", async () => {
    const result = await planSubmitTool.execute({ plan: "step 1" }, toolCtx());
    expect(result.isError).toBeFalsy();
    expect(result.content).not.toMatch(/[\u4e00-\u9fff]/);
    // 中性句：不预设必有权限卡（auto/full 档不经询问），只描述批准/被拒语义。
    expect(result.content).not.toMatch(/permission prompt/i);
    expect(result.content).toMatch(/approval|approved/i);
    expect(result.content).toMatch(/write operation/i);
    expect(result.content).toMatch(/declined|rejected/i);
  });
});

describe("planflow plugin mounting", () => {
  it("registers the tool through the real permission gate and one order-910 processor", async () => {
    const mounted = await mountPlanflow();
    expect(mounted.ctx.tools.get(PLAN_SUBMIT_TOOL_NAME)).toBe(planSubmitTool);
    expect(mounted.processors).toHaveLength(1);
    expect(mounted.processors[0].name).toBe("planflow");
    expect(mounted.processors[0].order).toBe(PLANFLOW_PROCESSOR_ORDER);
    expect(PLANFLOW_PROCESSOR_ORDER).toBe(910);
  });
});

describe("permission event listener", () => {
  it("an ask-stage allow verdict approves the plan through the permissions service", async () => {
    const mounted = await mountPlanflow();
    emitPermission(mounted.ctx, "allow", "ask");
    expect(mounted.approveCalls.count).toBe(1);
  });

  it("an ask-stage deny verdict records rejection without touching approvePlan", async () => {
    const mounted = await mountPlanflow();
    emitPermission(mounted.ctx, "deny", "ask");
    expect(mounted.approveCalls.count).toBe(0);
  });

  it("engine short-circuit resolutions are not user verdicts and change nothing", async () => {
    const mounted = await mountPlanflow();
    // plan 档 readOnly 自动放行（planReadOnly）：不是用户决议，不得自我批准。
    emitPermission(mounted.ctx, "allow", "planReadOnly");
    expect(mounted.approveCalls.count).toBe(0);
    const afterAllow = makeMessage("next turn");
    await mounted.processors[0].process(afterAllow, makeProcessorContext());
    expect(textsOf(afterAllow)).toEqual(["next turn"]);
    // plan 档写操作硬拒（planMode）：不是用户决议，不得注入被拒提醒。
    emitPermission(mounted.ctx, "deny", "planMode");
    const afterDeny = makeMessage("next turn 2");
    await mounted.processors[0].process(afterDeny, makeProcessorContext());
    expect(textsOf(afterDeny)).toEqual(["next turn 2"]);
  });

  it("ignores permission events for other tools and non-permission events", async () => {
    const mounted = await mountPlanflow();
    emitPermission(mounted.ctx, "allow", "ask", "TodoWrite");
    mounted.ctx.emit("harness/event", { type: "token", text: "x" });
    mounted.ctx.emit("harness/event", { type: "turnStart", turn: 1 });
    expect(mounted.approveCalls.count).toBe(0);
    const message = makeMessage("next turn");
    await mounted.processors[0].process(message, makeProcessorContext());
    expect(textsOf(message)).toEqual(["next turn"]);
  });

  it("drops the subscription when the plugin fiber unloads (EventBus fiber ownership)", async () => {
    const mounted = await mountPlanflow();
    await mounted.fiber.dispose();
    emitPermission(mounted.ctx, "allow", "ask");
    expect(mounted.approveCalls.count).toBe(0);
  });

  it("drops verdicts arriving while the permissions service is absent (no false unlock)", async () => {
    // 无权限脊柱的内核（拆卸竞态/极简宿主）：缺席窗口内到达的决议整体
    // 丢弃——不崩溃、不解锁、不注入"已批准"提醒。
    const ctx = new Context();
    const processors: MessageProcessor[] = [];
    await ctx.plugin(ToolsPlugin);
    ctx.provide("session", {
      registerProcessor: (p: MessageProcessor) => processors.push(p),
    });
    await ctx.plugin(PlanflowPlugin);
    expect(() => emitPermission(ctx, "allow", "ask")).not.toThrow();
    const message = makeMessage("next turn");
    await processors[0].process(message, makeProcessorContext());
    expect(textsOf(message)).toEqual(["next turn"]);
  });
});

describe("planflow reminder processor", () => {
  it("injects nothing while the verdict is pending and never rewrites existing parts", async () => {
    const mounted = await mountPlanflow();
    const message = makeMessage("please proceed");
    const returned = await mounted.processors[0].process(message, makeProcessorContext());
    expect(returned).toBe(message);
    expect(message.parts).toEqual([{ type: "text", text: "please proceed" }]);
  });

  it("after approval appends exactly two envelopes once, then consumes the state", async () => {
    const mounted = await mountPlanflow(); // 默认伪引擎档位 plan
    emitPermission(mounted.ctx, "allow", "ask");
    const message = makeMessage("go ahead");
    await mounted.processors[0].process(message, makeProcessorContext());
    const texts = textsOf(message);
    expect(texts).toHaveLength(3);
    expect(message.parts[0]).toEqual({ type: "text", text: "go ahead" });
    const [first, second] = [texts[1], texts[2]];
    for (const body of [first, second]) {
      expect(body).toContain("<system-reminder>");
      expect(body).toContain("</system-reminder>");
    }
    const [unlockEnvelope, recordEnvelope] = approvedReminderEnvelopes("plan");
    expect(first).toBe(unlockEnvelope);
    expect(second).toBe(recordEnvelope);
    // plan 档下第一条含子代理只读分工句（面向主代理的解锁提示）。
    expect(first).toMatch(/subagent/i);
    // 只注入一次：后续消息不再追加。
    const again = makeMessage("still going");
    await mounted.processors[0].process(again, makeProcessorContext());
    expect(textsOf(again)).toEqual(["still going"]);
  });

  it("outside plan mode the approval pair drops the subagent-duty sentence (mode-neutral text)", async () => {
    const mounted = await mountPlanflow();
    mounted.mode.value = "ask"; // 批准后切档：注入时读到的档位决定措辞
    emitPermission(mounted.ctx, "allow", "ask");
    const message = makeMessage("go ahead");
    await mounted.processors[0].process(message, makeProcessorContext());
    const texts = textsOf(message);
    expect(texts).toHaveLength(3);
    const [unlockEnvelope, recordEnvelope] = approvedReminderEnvelopes("ask");
    expect(texts[1]).toBe(unlockEnvelope);
    expect(texts[2]).toBe(recordEnvelope);
    expect(texts[1]).not.toMatch(/subagent/i);
    expect(texts[1]).toMatch(/approval/i);
  });

  it("child sessions never consume the verdict reminders (owner-session gating)", async () => {
    // 真实时序：父会话输入先过管线（未决不注入）→ 模型提交获准（事件置
    // approved）→ 同轮派生子代理；子代理按对象继承本处理器实例，其输入
    // 不得注入面向主代理的信封，也不得消费注入机会。
    const mounted = await mountPlanflow();
    const parentFirst = makeMessage("research and plan");
    await mounted.processors[0].process(parentFirst, makeProcessorContext("parent"));
    expect(textsOf(parentFirst)).toEqual(["research and plan"]); // 未决
    emitPermission(mounted.ctx, "allow", "ask");
    const child = makeMessage("research this and return findings");
    await mounted.processors[0].process(child, makeProcessorContext("child-1"));
    expect(textsOf(child)).toEqual(["research this and return findings"]); // 子会话不注入
    const parentSecond = makeMessage("go ahead");
    await mounted.processors[0].process(parentSecond, makeProcessorContext("parent"));
    expect(textsOf(parentSecond)).toHaveLength(3); // 属主会话仍注入一次（未被消费）
  });

  it("after rejection appends one revise-and-resubmit envelope once", async () => {
    const mounted = await mountPlanflow();
    emitPermission(mounted.ctx, "deny", "ask");
    const message = makeMessage("what now");
    await mounted.processors[0].process(message, makeProcessorContext());
    const texts = textsOf(message);
    expect(texts).toHaveLength(2);
    expect(texts[1]).toBe(DENIED_REMINDER.enveloped);
    const again = makeMessage("and now");
    await mounted.processors[0].process(again, makeProcessorContext());
    expect(textsOf(again)).toEqual(["and now"]);
  });

  it("a fresh verdict after consumption re-arms injection (revise -> resubmit -> approve)", async () => {
    const mounted = await mountPlanflow();
    emitPermission(mounted.ctx, "deny", "ask");
    const rejected = makeMessage("revise it");
    await mounted.processors[0].process(rejected, makeProcessorContext());
    expect(textsOf(rejected)).toHaveLength(2);
    emitPermission(mounted.ctx, "allow", "ask");
    expect(mounted.approveCalls.count).toBe(1);
    const approved = makeMessage("retry");
    await mounted.processors[0].process(approved, makeProcessorContext());
    expect(textsOf(approved)).toHaveLength(3);
  });
});

describe("end to end", () => {
  it("mount -> allow verdict -> processed user message carries both envelopes", async () => {
    const mounted = await mountPlanflow();
    emitPermission(mounted.ctx, "allow", "ask");
    const message = makeMessage("start implementing");
    await mounted.processors[0].process(message, makeProcessorContext());
    const joined = textsOf(message).join("\n");
    expect(joined).toContain("<system-reminder>");
    expect(joined).toMatch(/approval|approved/i);
    expect(joined).toMatch(/plan/i);
    expect(message.parts[0]).toEqual({ type: "text", text: "start implementing" });
  });

  it("plan mode closes the loop: submission asks, allow verdict approves, writes fall to the regular ladder", async () => {
    // 真引擎 + 真权限服务（唯一伪件：decider 记录并回答 allow，模拟权限卡）。
    const asked: PermissionRequest[] = [];
    const engine = new PermissionEngine({
      mode: "plan",
      decider: {
        ask: async (req) => {
          asked.push(req);
          return "allow";
        },
      },
    });
    const service = createPermissionsService(engine);
    const ctx = new Context();
    const processors: MessageProcessor[] = [];
    await ctx.plugin(ToolsPlugin);
    ctx.provide("permissions", service);
    ctx.provide("session", {
      registerProcessor: (p: MessageProcessor) => processors.push(p),
    });
    await ctx.plugin(PlanflowPlugin);

    const writeRequest: PermissionRequest = {
      toolName: "Edit",
      resource: { action: "write", kind: "path", scope: "src/a.ts" },
      args: {},
    };
    // 未批准 plan 档：写操作 planMode 硬拒。
    expect((await engine.resolve(writeRequest, { readOnly: false })).via).toBe("planMode");

    // plan 档内 plan_submit 资源经引擎特例直达 ask，用户在卡上允许。
    const submitResolution = await engine.resolve(
      {
        toolName: PLAN_SUBMIT_TOOL_NAME,
        resource: { action: "submit", kind: "plan", scope: "session" },
        args: { plan: "step 1" },
      },
      { readOnly: true },
    );
    expect(submitResolution.decision).toBe("allow");
    expect(submitResolution.via).toBe("ask");

    // loop 语义：每次决议发射 permission 事件 -> 监听器 -> 真 approvePlan。
    ctx.emit("harness/event", {
      type: "permission",
      id: "perm-1",
      toolName: PLAN_SUBMIT_TOOL_NAME,
      resolution: submitResolution,
    });
    const message = makeMessage("implement now");
    await processors[0].process(message, makeProcessorContext());
    expect(textsOf(message)).toHaveLength(3); // 批准对已注入（原文 + 两条信封）

    // 批准后写资源不再 planMode 硬拒：落回常规管线末端 ask，逐项放行。
    const afterApproval = await engine.resolve(writeRequest, { readOnly: false });
    expect(afterApproval.decision).toBe("allow");
    expect(afterApproval.via).toBe("ask");
    expect(asked.map((r) => r.toolName)).toEqual([PLAN_SUBMIT_TOOL_NAME, "Edit"]);
  });
});

describe("text discipline", () => {
  it("reminder and confirmation bodies are English and banned-token free", async () => {
    const bodies = [
      APPROVAL_BASE_BODY,
      APPROVAL_PLAN_DUTY_BODY,
      PLAN_RECORD_BODY,
      DENIED_REMINDER.body,
      (await planSubmitTool.execute({ plan: "step 1" }, toolCtx())).content,
    ];
    for (const body of bodies) {
      expect(body).not.toMatch(/[\u4e00-\u9fff]/);
      for (const re of [/Claude/i, /Anthropic/i, /OpenAI/i, /ChatGPT/i, /Codex/i, /Gemini/i]) {
        expect(body).not.toMatch(re);
      }
    }
  });
});
