import { describe, expect, it } from "vitest";
import { Script } from "node:vm";
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
    expect(ctx.tools.specs().map((t) => t.name)).toContain("creation_docs");
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

  it("documents the manifest agentMode metadata contract for the mode switcher", () => {
    const text = creationFragments.map((f) => f.render({ activeMode: "creation", traits: {} })).join("\n");
    expect(text).toContain("innocenceharness");
    expect(text).toContain("agentMode");
  });

  it("workflow mandates reading the bundled creation doc before designing", () => {
    const text = creationFragments.map((f) => f.render({ activeMode: "creation", traits: {} })).join("\n");
    expect(text).toContain("Read the creation doc");
    expect(text).toContain("creation_docs");
    expect(text).toContain("nine steps");
  });
});

describe("creation_docs tool", () => {
  async function toolOf() {
    const ctx = await setup();
    const tool = ctx.tools.get("creation_docs");
    expect(tool).toBeDefined();
    return tool!;
  }

  it("lists every bundled type with a summary when type is omitted", async () => {
    const tool = await toolOf();
    const result = await tool.execute({}, { workspaceRoot: "/tmp", signal: new AbortController().signal, log: () => {} } as never);
    expect(result.isError).toBeUndefined();
    for (const type of ["overview", "tool", "skill", "agent-mode", "message-processor", "provider"]) {
      expect(result.content).toContain(type);
    }
  });

  it("returns the full format doc for a type", async () => {
    const tool = await toolOf();
    const result = await tool.execute({ type: "tool" }, { workspaceRoot: "/tmp", signal: new AbortController().signal, log: () => {} } as never);
    expect(result.isError).toBeUndefined();
    expect(result.content).toContain("ctx.tools.register");
    expect(result.content).toContain("permissionResource");
  });

  it("every type doc is a beginner walkthrough: example files, smoke test, install, verify, troubleshooting", async () => {
    const tool = await toolOf();
    for (const type of ["tool", "skill", "agent-mode", "message-processor", "provider"]) {
      const result = await tool.execute({ type }, { workspaceRoot: "/tmp", signal: new AbortController().signal, log: () => {} } as never);
      expect(result.content).toContain("What you will build");
      expect(result.content).toContain("copy-paste runnable");
      expect(result.content).toContain("package.json");
      expect(result.content).toContain("dist/index.js");
      expect(result.content).toContain('"type": "module"');
      expect(result.content).toContain("smoke.mjs");
      expect(result.content).toContain("install_user_plugin");
      expect(result.content).toContain("**Verify**");
      expect(result.content).toContain("Troubleshooting");
    }
    // overview 是导览篇：交付环 + 冒烟脚本同样在位。
    const overview = await tool.execute({ type: "overview" }, { workspaceRoot: "/tmp", signal: new AbortController().signal, log: () => {} } as never);
    expect(overview.content).toContain("install_user_plugin");
    expect(overview.content).toContain("smoke.mjs");
    expect(overview.content).toContain("Troubleshooting");
  });

  it("overview carries the universal loader rules, the choose-type table and the shared smoke script", async () => {
    const tool = await toolOf();
    const result = await tool.execute({ type: "overview" }, { workspaceRoot: "/tmp", signal: new AbortController().signal, log: () => {} } as never);
    expect(result.content).toContain("NO imports");
    expect(result.content).toContain("node smoke.mjs");
    expect(result.content).toContain("How to choose the plugin type");
    expect(result.content).toContain("Verification checklist");
  });

  it("the smoke script itself is valid JavaScript (parsed, not just quoted)", async () => {
    const tool = await toolOf();
    const result = await tool.execute({ type: "overview" }, { workspaceRoot: "/tmp", signal: new AbortController().signal, log: () => {} } as never);
    const start = result.content.indexOf('title="smoke.mjs — the universal loader probe"');
    expect(start).toBeGreaterThan(-1);
    const bodyStart = result.content.indexOf("\n", start) + 1;
    const bodyEnd = result.content.indexOf("```", bodyStart);
    const script = result.content.slice(bodyStart, bodyEnd);
    expect(script).toContain("pathToFileURL");
    // Parse-only check (imports stripped): syntax errors in the quoted script fail here.
    new Script("(async()=>{" + script.replace(/^import[^\n]*\n/gm, "") + "})()");
  });

  it("rejects unknown types in validateArgs and fails closed in execute", async () => {
    const tool = await toolOf();
    expect(() => tool.validateArgs?.({ type: "nope" })).toThrow();
    const result = await tool.execute({ type: "nope" }, { workspaceRoot: "/tmp", signal: new AbortController().signal, log: () => {} } as never);
    expect(result.isError).toBe(true);
    expect(result.content).toContain("nope");
  });

  it("is read-only with a stable permission resource", async () => {
    const tool = await toolOf();
    expect(tool.readOnly).toBe(true);
    expect(tool.permissionResource({}, {} as never)).toEqual({
      action: "read",
      kind: "plugin",
      scope: "creation-docs",
    });
  });

  it("bundled docs stay English and free of banned tokens", async () => {
    const tool = await toolOf();
    const banned = [/Claude/i, /Anthropic/i, /OpenAI/i, /Codex/i, /ChatGPT/i, /Gemini/i];
    for (const type of ["overview", "tool", "skill", "agent-mode", "message-processor", "provider"]) {
      const result = await tool.execute({ type }, { workspaceRoot: "/tmp", signal: new AbortController().signal, log: () => {} } as never);
      expect(result.content).not.toMatch(/[\u4e00-\u9fff]/);
      for (const re of banned) expect(result.content).not.toMatch(re);
    }
  });
});
