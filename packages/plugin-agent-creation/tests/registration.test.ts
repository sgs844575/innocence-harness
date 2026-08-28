import { describe, expect, it } from "vitest";
import { Context } from "@innocenceharness/kernel";
import { ToolsPlugin } from "@innocenceharness/harness-tools";
import { AgentsPlugin } from "@innocenceharness/harness-agent";
import { SystemPromptPlugin } from "@innocenceharness/harness-system-prompt";
import { createCreationPlugin, creationFragments } from "../src";

// `ctx.plugin` never runs plugin code synchronously (kernel fiber contract),
// so the helper awaits each load before touching the services.
async function setup(): Promise<Context> {
  const ctx = new Context();
  await ctx.plugin(ToolsPlugin);
  await ctx.plugin(AgentsPlugin);
  await ctx.plugin(SystemPromptPlugin);
  await ctx.plugin(createCreationPlugin({ userRoot: "C:/unused" }));
  return ctx;
}

describe("creation agent mode plugin", () => {
  it("registers the creation mode and its tool", async () => {
    const ctx = await setup();
    expect(ctx.agents.byId("creation")?.title).toBe("Creation");
    expect(ctx.tools.specs().map((t) => t.name)).toContain("install_user_plugin");
  });

  it("creation fragments are creation-tagged and share-neutral", async () => {
    const ctx = await setup();
    const prompt = ctx.systemPrompt.build([], { activeMode: "creation", traits: {} });
    expect(prompt).toContain("plugin");
  });

  it("fragments carry no banned tokens", () => {
    const banned = [/Claude/i, /Anthropic/i, /OpenAI/i, /Codex/i, /ChatGPT/i, /Gemini/i];
    for (const f of creationFragments) {
      const text = f.render({ activeMode: "creation", traits: {} });
      for (const re of banned) expect(`${f.id}: ${text}`).not.toMatch(re);
    }
  });
});
