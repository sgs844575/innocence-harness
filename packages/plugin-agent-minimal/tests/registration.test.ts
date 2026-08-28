import { describe, expect, it } from "vitest";
import { Context } from "@innocenceharness/kernel";
import { ToolsPlugin } from "@innocenceharness/harness-tools";
import { AgentsPlugin } from "@innocenceharness/harness-agent";
import { SystemPromptPlugin } from "@innocenceharness/harness-system-prompt";
import MinimalModePlugin from "../src";

// `ctx.plugin` never runs plugin code synchronously (kernel fiber contract),
// so the helper awaits each load before touching the services.
async function setup(): Promise<Context> {
  const ctx = new Context();
  await ctx.plugin(ToolsPlugin);
  await ctx.plugin(AgentsPlugin);
  await ctx.plugin(SystemPromptPlugin);
  await ctx.plugin(MinimalModePlugin);
  return ctx;
}

describe("minimal agent mode", () => {
  it("registers the minimal mode definition", async () => {
    expect((await setup()).agents.byId("minimal")?.title).toBe("Minimal");
  });

  it("mode fragments load only for the active mode", async () => {
    const ctx = await setup();
    const asMinimal = ctx.systemPrompt.build([], { activeMode: "minimal", traits: {} });
    const asDefault = ctx.systemPrompt.build([], { activeMode: "default", traits: {} });
    expect(asMinimal.length).toBeGreaterThan(asDefault.length);
    expect(asDefault).not.toContain(asMinimal.slice(60)); // 模式片段不进 default（前 60 字符可能是 base/共享头）
  });

  it("is English and free of banned tokens", async () => {
    const text = (await setup()).systemPrompt.build([], { activeMode: "minimal", traits: {} });
    expect(text).not.toMatch(/[\u4e00-\u9fff]/);
    for (const re of [/Claude/i, /Anthropic/i, /OpenAI/i, /ChatGPT/i, /Codex/i, /Gemini/i]) {
      expect(text).not.toMatch(re);
    }
  });
});
