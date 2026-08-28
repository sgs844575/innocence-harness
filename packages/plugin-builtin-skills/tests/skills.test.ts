import { describe, expect, it } from "vitest";
import { Context } from "@innocenceharness/kernel";
import { ToolsPlugin } from "@innocenceharness/harness-tools";
import { SkillsPlugin } from "@innocenceharness/harness-skills";
import { SystemPromptPlugin } from "@innocenceharness/harness-system-prompt";
import BuiltinSkillsPlugin, { builtinSkills } from "../src";

// `ctx.plugin` never runs plugin code synchronously (kernel fiber contract),
// so the helper awaits each load before touching the services.
async function setup(extraSkills = false): Promise<Context> {
  const ctx = new Context();
  await ctx.plugin(ToolsPlugin);
  await ctx.plugin(SkillsPlugin);
  await ctx.plugin(SystemPromptPlugin);
  if (extraSkills) {
    // 模拟磁盘技能插件先行注册同名技能：内置包须容忍冲突（先到先得），
    // 不得让会话装配整体失败。
    ctx.skills.register({
      name: "debugging",
      description: "pre-existing disk skill with the same name",
      loadBody: async () => "disk body",
    });
  }
  await ctx.plugin(BuiltinSkillsPlugin);
  return ctx;
}

describe("builtin skills", () => {
  it("registers thirteen skills with unique names", () => {
    const names = builtinSkills.map((s) => s.name);
    expect(new Set(names).size).toBe(13);
    expect(names).toEqual([
      "debugging",
      "code-review",
      "verify",
      "run-app",
      "data-visualization",
      "agent-design-patterns",
      "stuck-diagnostics",
      "cost-optimization",
      "prompt-audit",
      "model-migration",
      "permission-allowlist",
      "harness-configuration",
      "repo-instructions",
    ]);
    for (const s of builtinSkills) {
      expect(s.description.length).toBeGreaterThan(20);
      expect(s.body.length).toBeGreaterThan(400);
    }
  });

  it("loadBody resolves to the body content", async () => {
    for (const s of builtinSkills) {
      await expect(s.loadBody()).resolves.toBe(s.body);
    }
  });

  it("feeds the skills index in the assembled prompt", async () => {
    const ctx = await setup();
    const prompt = ctx.systemPrompt.build(ctx.skills.all(), {
      activeMode: "default",
      traits: {},
    });
    // Full index coverage: every builtin skill name has its index row.
    for (const s of builtinSkills) {
      expect(prompt).toContain(`- ${s.name}:`);
    }
  });

  it("registers all thirteen on the skills service in order", async () => {
    const ctx = await setup();
    expect(ctx.skills.all().map((s) => s.name)).toEqual(
      builtinSkills.map((s) => s.name),
    );
  });

  it("tolerates name collisions: earlier registration wins, apply never throws", async () => {
    const ctx = await setup(true);
    const debugging = ctx.skills.get("debugging");
    expect(await debugging?.loadBody()).toBe("disk body");
    expect(ctx.skills.all().map((s) => s.name)).toHaveLength(13);
  });

  it("is English and free of banned tokens", () => {
    for (const s of builtinSkills) {
      expect(s.body).not.toMatch(/[\u4e00-\u9fff]/);
      for (const re of [/Claude/i, /Anthropic/i, /OpenAI/i, /ChatGPT/i, /Codex/i, /Gemini/i]) {
        expect(`${s.name}:${s.description}:${s.body}`).not.toMatch(re);
      }
    }
  });
});
