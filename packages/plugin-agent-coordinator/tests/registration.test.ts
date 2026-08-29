import { describe, expect, it } from "vitest";
import { Context } from "@innocenceharness/kernel";
import { ToolsPlugin } from "@innocenceharness/harness-tools";
import { AgentsPlugin } from "@innocenceharness/harness-agent";
import { SystemPromptPlugin } from "@innocenceharness/harness-system-prompt";
import CoordinatorModePlugin, { coordinatorModeFragments } from "../src";

// `ctx.plugin` never runs plugin code synchronously (kernel fiber contract),
// so the helper awaits each load before touching the services.
async function setup(): Promise<Context> {
  const ctx = new Context();
  await ctx.plugin(ToolsPlugin);
  await ctx.plugin(AgentsPlugin);
  await ctx.plugin(SystemPromptPlugin);
  await ctx.plugin(CoordinatorModePlugin);
  return ctx;
}

describe("coordinator agent mode", () => {
  it("registers the coordinator mode definition", async () => {
    expect((await setup()).agents.byId("coordinator")?.title).toBe("Coordinator");
  });

  it("mode fragments load only for the active mode", async () => {
    const ctx = await setup();
    const asCoordinator = ctx.systemPrompt.build([], { activeMode: "coordinator", traits: {} });
    const asDefault = ctx.systemPrompt.build([], { activeMode: "default", traits: {} });
    const asCreation = ctx.systemPrompt.build([], { activeMode: "creation", traits: {} });
    expect(asCoordinator.length).toBeGreaterThan(asDefault.length);
    expect(asDefault).not.toContain(asCoordinator.slice(60)); // 模式片段不进 default（前 60 字符可能是 base/共享头）
    expect(asDefault).not.toMatch(/# Coordinator Mode/);
    expect(asCreation).not.toMatch(/# Coordinator Mode/);
  });

  it("is English and free of banned tokens", async () => {
    const text = (await setup()).systemPrompt.build([], { activeMode: "coordinator", traits: {} });
    expect(text).not.toMatch(/[\u4e00-\u9fff]/);
    for (const re of [/Claude/i, /Anthropic/i, /OpenAI/i, /ChatGPT/i, /Codex/i, /Gemini/i]) {
      expect(text).not.toMatch(re);
    }
  });
});

// 五簇必点锚点（批次 4E 任务 2）：编排者人格（双执行者+状态跟踪+汇总）、
// 工人简报纪律（自包含五件）、对等消息权威（核实后转述）、批准门（先呈报
// 后执行+重大变更重呈报）、沟通礼仪（无歧义指示/澄清非指责/聚合汇报）。
// 英文/禁词/中文纪律由上面 "is English and free of banned tokens"（build
// 全文扫描）一并覆盖。多词锚点用 \s+ 连接：片段正文按 ~72 列硬换行，
// 词组可能跨行。
describe("coordinator persona required clusters", () => {
  const persona = coordinatorModeFragments.find((fragment) => fragment.id === "coordinator.persona");
  const text = persona?.render({ activeMode: "coordinator", traits: {} }) ?? "";

  it("contributes exactly one coordinator-tagged persona fragment", () => {
    expect(persona, '缺少片段 "coordinator.persona"').toBeDefined();
    expect(persona).toMatchObject({ order: 2000, modes: ["coordinator"] });
    expect(coordinatorModeFragments).toHaveLength(1);
  });

  it("keeps the persona within the briefed 280-360 word budget", () => {
    const words = text.split(/\s+/).filter((w) => w.length > 0).length;
    expect(words).toBeGreaterThanOrEqual(280);
    expect(words).toBeLessThanOrEqual(360);
  });

  it("covers orchestration: goal decomposition, two executor kinds, status tracking, synthesis", () => {
    for (const anchor of [
      /work\s+items/i,
      /send_message/,
      /\bTask\b/,
      /persistent\s+context/i,
      /state\s+of\s+every\s+item/i,
      /single\s+consolidated\s+answer/i,
    ]) {
      expect(text, `编排者人格锚点缺失：${anchor}`).toMatch(anchor);
    }
  });

  it("covers self-contained worker briefs (goal, context+paths, acceptance, boundary, no shared history)", () => {
    for (const anchor of [
      /Nobody\s+you\s+dispatch\s+can\s+read\s+this\s+conversation/i,
      /file\s+paths/i,
      /acceptance\s+criteria/i,
      /boundary/i,
    ]) {
      expect(text, `工人简报纪律锚点缺失：${anchor}`).toMatch(anchor);
    }
  });

  it("covers peer-message authority: verify before relaying", () => {
    for (const anchor of [
      /reports,\s+not\s+proof/i,
      /check\s+it\s+yourself/i,
      /unverified\s+assertion/i,
    ]) {
      expect(text, `对等消息权威锚点缺失：${anchor}`).toMatch(anchor);
    }
  });

  it("covers the user approval gate and mid-flight re-approval", () => {
    for (const anchor of [
      /present\s+the\s+plan/i,
      /dispatch\s+scheme/i,
      /approval/i,
      /before\s+executing/i,
      /wider\s+scope/i,
    ]) {
      expect(text, `批准门锚点缺失：${anchor}`).toMatch(anchor);
    }
  });

  it("covers communication etiquette: unambiguous asks, clarification over blame, digested reporting", () => {
    for (const anchor of [
      /cannot\s+be\s+misread/i,
      /one\s+work\s+item,\s+one\s+request/i,
      /ask\s+for\s+clarification/i,
      /digest/i,
      /raw\s+teammate/i,
    ]) {
      expect(text, `沟通礼仪锚点缺失：${anchor}`).toMatch(anchor);
    }
  });
});
