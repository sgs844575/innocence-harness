import { describe, expect, it } from "vitest";
import { Context } from "@innocenceharness/kernel";
import { ToolsPlugin } from "@innocenceharness/harness-tools";
import { AgentsPlugin } from "@innocenceharness/harness-agent";
import { SystemPromptPlugin } from "@innocenceharness/harness-system-prompt";
import LearningModePlugin from "../src";

// `ctx.plugin` never runs plugin code synchronously (kernel fiber contract),
// so the helper awaits each load before touching the services.
async function setup(): Promise<Context> {
  const ctx = new Context();
  await ctx.plugin(ToolsPlugin);
  await ctx.plugin(AgentsPlugin);
  await ctx.plugin(SystemPromptPlugin);
  await ctx.plugin(LearningModePlugin);
  return ctx;
}

// 该包目录名是 plugin-agent-learn，但注册的模式 id 是 "learning"（staging
// id = 注册模式 id 不变量）：目录名与模式 id 允许不同，清单 id 锁死 "learning"。
describe("learning agent mode", () => {
  it("registers the learning mode definition", async () => {
    expect((await setup()).agents.byId("learning")?.title).toBe("Learning");
  });

  it("mode fragments load only for the active mode", async () => {
    const ctx = await setup();
    const asLearning = ctx.systemPrompt.build([], { activeMode: "learning", traits: {} });
    const asDefault = ctx.systemPrompt.build([], { activeMode: "default", traits: {} });
    expect(asLearning.length).toBeGreaterThan(asDefault.length);
    expect(asDefault).not.toContain(asLearning.slice(60)); // 模式片段不进 default（前 60 字符可能是 base/共享头）
  });

  it("is English and free of banned tokens", async () => {
    const text = (await setup()).systemPrompt.build([], { activeMode: "learning", traits: {} });
    expect(text).not.toMatch(/[\u4e00-\u9fff]/);
    for (const re of [/Claude/i, /Anthropic/i, /OpenAI/i, /ChatGPT/i, /Codex/i, /Gemini/i]) {
      expect(text).not.toMatch(re);
    }
  });
});
