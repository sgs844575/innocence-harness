import { describe, expect, it } from "vitest";
import { Context } from "@innocenceharness/kernel";
import { ToolsPlugin } from "@innocenceharness/harness-tools";
import { AgentsPlugin } from "@innocenceharness/harness-agent";
import { SystemPromptPlugin } from "@innocenceharness/harness-system-prompt";
import DefaultAgentModePlugin from "../src";

// `ctx.plugin` never runs plugin code synchronously (kernel fiber contract),
// so the helper awaits each load before touching the services.
async function setup(): Promise<Context> {
  const ctx = new Context();
  await ctx.plugin(ToolsPlugin);
  await ctx.plugin(AgentsPlugin);
  await ctx.plugin(SystemPromptPlugin);
  await ctx.plugin(DefaultAgentModePlugin);
  return ctx;
}

describe("default agent mode plugin", () => {
  it("registers the default mode definition", async () => {
    const ctx = await setup();
    expect(ctx.agents.byId("default")?.title).toBe("Default");
  });

  it("contributes fragments assembling an English prompt with the identity anchor", async () => {
    const ctx = await setup();
    ctx.systemPrompt.setBase("BASE");
    const prompt = ctx.systemPrompt.build([], { activeMode: "default", traits: {} });
    expect(prompt).toContain("# Harness");
    expect(prompt.startsWith("BASE")).toBe(true);
  });

  it("keeps shared fragments mounted for other modes while mode fragments drop out", async () => {
    const ctx = await setup();
    const asDefault = ctx.systemPrompt.build([], { activeMode: "default", traits: {} });
    const asOther = ctx.systemPrompt.build([], { activeMode: "creation", traits: {} });
    expect(asOther.length).toBeLessThan(asDefault.length);
  });
});
