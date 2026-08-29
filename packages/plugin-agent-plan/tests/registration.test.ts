import { describe, expect, it } from "vitest";
import { Context } from "@innocenceharness/kernel";
import { ToolsPlugin } from "@innocenceharness/harness-tools";
import { AgentsPlugin } from "@innocenceharness/harness-agent";
import { SystemPromptPlugin } from "@innocenceharness/harness-system-prompt";
import PlanModePlugin, { planModeFragments } from "../src";

// `ctx.plugin` never runs plugin code synchronously (kernel fiber contract),
// so the helper awaits each load before touching the services.
async function setup(): Promise<Context> {
  const ctx = new Context();
  await ctx.plugin(ToolsPlugin);
  await ctx.plugin(AgentsPlugin);
  await ctx.plugin(SystemPromptPlugin);
  await ctx.plugin(PlanModePlugin);
  return ctx;
}

describe("plan agent mode", () => {
  it("registers the plan mode definition", async () => {
    expect((await setup()).agents.byId("plan")?.title).toBe("Plan");
  });

  it("mode fragments load only for the active mode", async () => {
    const ctx = await setup();
    const asPlan = ctx.systemPrompt.build([], { activeMode: "plan", traits: {} });
    const asDefault = ctx.systemPrompt.build([], { activeMode: "default", traits: {} });
    expect(asPlan.length).toBeGreaterThan(asDefault.length);
    expect(asDefault).not.toContain(asPlan.slice(60)); // 模式片段不进 default（前 60 字符可能是 base/共享头）
  });

  it("is English and free of banned tokens", async () => {
    const text = (await setup()).systemPrompt.build([], { activeMode: "plan", traits: {} });
    expect(text).not.toMatch(/[\u4e00-\u9fff]/);
    for (const re of [/Claude/i, /Anthropic/i, /OpenAI/i, /ChatGPT/i, /Codex/i, /Gemini/i]) {
      expect(text).not.toMatch(re);
    }
  });
});

// 批次 4A 任务 3：工作法增补段（plan.persona.workflow）——阶段语义
// （理解→设计→成稿→呈报）、被拒重入纪律、可弃原型选项三块语义各自的
// 存在性锚点；英文/禁词/中文纪律由上面 "is English and free of banned
// tokens"（build 全文扫描）一并覆盖。
describe("plan persona workflow augmentation", () => {
  const workflow = planModeFragments.find((fragment) => fragment.id === "plan.persona.workflow");
  const text = workflow?.render({ activeMode: "plan", traits: {} }) ?? "";

  it("adds a second plan-mode fragment after the base persona", () => {
    expect(workflow, '缺少片段 "plan.persona.workflow"').toBeDefined();
    expect(workflow).toMatchObject({ order: 2010, modes: ["plan"] });
    expect(planModeFragments.map((fragment) => fragment.order)).toEqual([2000, 2010]);
  });

  it("covers the staged working method (understand, design, draft, submit)", () => {
    for (const anchor of [/understand/i, /design/i, /draft/i, /approval/i]) {
      expect(text, `工作法阶段锚点缺失：${anchor}`).toMatch(anchor);
    }
    // 呈报措辞中性（不硬编码工具名；批准面由用户裁决）
    expect(text).toMatch(/wait/i);
  });

  it("covers the re-entry discipline after rejection", () => {
    // 锚点用 \s+ 连接：片段正文按 ~80 列硬换行，词组可能跨行。
    for (const anchor of [/rejection/i, /feedback/i, /revised/i, /already\s+accepted/i]) {
      expect(text, `重入纪律锚点缺失：${anchor}`).toMatch(anchor);
    }
    expect(text).toMatch(/submit .*again|again.*submit|another review/i);
  });

  it("covers the throwaway prototype option", () => {
    for (const anchor of [/prototype/i, /disposable/i, /risky\s+assumption/i, /full\s+implementation/i]) {
      expect(text, `原型选项锚点缺失：${anchor}`).toMatch(anchor);
    }
    expect(text).toMatch(/let the user (pick|choose)/i);
  });

  it("keeps both fragments plan-gated at build time", async () => {
    const ctx = await setup();
    const asPlan = ctx.systemPrompt.build([], { activeMode: "plan", traits: {} });
    const asDefault = ctx.systemPrompt.build([], { activeMode: "default", traits: {} });
    expect(asPlan).toMatch(/# Plan Working Method/);
    expect(asDefault).not.toMatch(/# Plan Working Method/);
  });
});
