import { ToolsPlugin } from "@innocenceharness/harness-tools";
import { SkillsPlugin, type Skill } from "@innocenceharness/harness-skills";
import { Context } from "@innocenceharness/kernel";
import {
  SystemPromptPlugin,
  type SystemPromptService,
} from "@innocenceharness/harness-system-prompt";
import { describe, expect, it } from "vitest";

// Mirrors harness-tools' test setup: load the plugin into a fresh kernel
// context; `ctx.systemPrompt` is live while the plugin fiber is active.
async function withPrompt(): Promise<Context> {
  const ctx = new Context();
  await ctx.plugin(SystemPromptPlugin);
  return ctx;
}

function skill(name: string, description: string): Skill {
  return { name, description, loadBody: async () => "" };
}

// Byte-for-byte equivalence anchors against the previous private
// AgentSession.buildSystemPrompt (harness-electron session.ts):
// no registered section may change any byte of its output.
describe("build equals the previous buildSystemPrompt output (byte anchors)", () => {
  it("base + skills index, single skill", async () => {
    const ctx = await withPrompt();
    ctx.systemPrompt.setBase("基础提示");
    expect(ctx.systemPrompt.build([skill("review", "代码审查指南")])).toBe(
      "基础提示\n\n可用技能（用户以 /名称 调用；相关时你也可以建议）：\n- review: 代码审查指南",
    );
  });

  it("base + skills index, multiple skills in registration order", async () => {
    const ctx = await withPrompt();
    ctx.systemPrompt.setBase("base");
    expect(
      ctx.systemPrompt.build([skill("review", "代码审查指南"), skill("plan", "计划指南")]),
    ).toBe(
      "base\n\n可用技能（用户以 /名称 调用；相关时你也可以建议）：\n- review: 代码审查指南\n- plan: 计划指南",
    );
  });

  it("returns the base unchanged when no skill is registered", async () => {
    const ctx = await withPrompt();
    ctx.systemPrompt.setBase("基础提示");
    expect(ctx.systemPrompt.build([])).toBe("基础提示");
  });

  it("keeps an empty prompt empty with no sections and no skills", async () => {
    const ctx = await withPrompt();
    expect(ctx.systemPrompt.build([])).toBe("");
  });

  it("appends the skills index to the system prompt (session.test.ts anchor)", async () => {
    const ctx = await withPrompt();
    ctx.systemPrompt.setBase("base");
    const systems: string[] = [ctx.systemPrompt.build([skill("review", "代码审查指南")])];
    expect(systems[0]).toContain("代码审查指南");
  });
});

describe("setBase", () => {
  it("defaults to an empty base prompt", async () => {
    const ctx = await withPrompt();
    expect(ctx.systemPrompt.build([])).toBe("");
  });

  it("replaces the base", async () => {
    const ctx = await withPrompt();
    ctx.systemPrompt.setBase("first");
    ctx.systemPrompt.setBase("second");
    expect(ctx.systemPrompt.build([])).toBe("second");
  });

  it("resets the base on undefined", async () => {
    const ctx = await withPrompt();
    ctx.systemPrompt.setBase("first");
    ctx.systemPrompt.setBase(undefined);
    expect(ctx.systemPrompt.build([])).toBe("");
  });
});

describe("registerFragment", () => {
  it("appends fragments after the base in ascending order", async () => {
    const ctx = await withPrompt();
    ctx.systemPrompt.setBase("base");
    ctx.systemPrompt.registerFragment({ id: "agents", order: 20, render: () => "agent 段" });
    ctx.systemPrompt.registerFragment({ id: "early", order: 10, render: () => "早段" });
    expect(ctx.systemPrompt.build([])).toBe("base\n\n早段\n\nagent 段");
  });

  it("breaks order ties by ascending fragment id", async () => {
    const ctx = await withPrompt();
    ctx.systemPrompt.setBase("base");
    ctx.systemPrompt.registerFragment({ id: "b", order: 10, render: () => "B" });
    ctx.systemPrompt.registerFragment({ id: "a", order: 10, render: () => "A" });
    expect(ctx.systemPrompt.build([])).toBe("base\n\nA\n\nB");
  });

  it("skips fragments that render to an empty string", async () => {
    const ctx = await withPrompt();
    ctx.systemPrompt.setBase("base");
    ctx.systemPrompt.registerFragment({ id: "empty", order: 0, render: () => "" });
    ctx.systemPrompt.registerFragment({ id: "kept", order: 1, render: () => "kept" });
    expect(ctx.systemPrompt.build([])).toBe("base\n\nkept");
  });

  it("places the skills index after every registered fragment", async () => {
    const ctx = await withPrompt();
    ctx.systemPrompt.setBase("base");
    ctx.systemPrompt.registerFragment({ id: "agents", order: 10, render: () => "agent 段" });
    expect(ctx.systemPrompt.build([skill("review", "代码审查指南")])).toBe(
      "base\n\nagent 段\n\n可用技能（用户以 /名称 调用；相关时你也可以建议）：\n- review: 代码审查指南",
    );
  });

  it("rejects duplicate fragment ids", async () => {
    const ctx = await withPrompt();
    ctx.systemPrompt.registerFragment({ id: "dup", order: 0, render: () => "x" });
    expect(() =>
      ctx.systemPrompt.registerFragment({ id: "dup", order: 1, render: () => "y" }),
    ).toThrow("duplicate prompt fragment registration: dup");
  });
});

describe("system-prompt service lifecycle on the kernel", () => {
  it("carries the spine plugin name \"harness-system-prompt\"", () => {
    expect(SystemPromptPlugin.name).toBe("harness-system-prompt");
  });

  it("publishes the service under \"systemPrompt\" while its fiber is active", async () => {
    const ctx = await withPrompt();
    expect((ctx as { systemPrompt?: SystemPromptService }).systemPrompt).toBeDefined();
    ctx.systemPrompt.setBase("live");
    expect(ctx.systemPrompt.build([])).toBe("live");
  });

  it("withdraws the service when the plugin fiber is disposed", async () => {
    const ctx = new Context();
    const fiber = await ctx.plugin(SystemPromptPlugin);
    const service = ctx.systemPrompt;
    expect((ctx as { systemPrompt?: SystemPromptService }).systemPrompt).toBeDefined();
    await fiber.dispose();
    // The withdraw handle returned by `apply` removed the context property;
    // the detached service object stays usable.
    expect((ctx as { systemPrompt?: SystemPromptService }).systemPrompt).toBeUndefined();
    expect(() => service.setBase("detached")).not.toThrow();
  });
});

// Fragments bucket by volatility (shared → mode → conditional → skills
// index). `ctx.plugin` never runs plugin code synchronously (kernel fiber
// contract), so the helper awaits each load before touching the service.
async function makeService(): Promise<SystemPromptService> {
  const ctx = new Context();
  await ctx.plugin(ToolsPlugin);
  await ctx.plugin(SkillsPlugin);
  await ctx.plugin(SystemPromptPlugin);
  return ctx.systemPrompt;
}

describe("fragment assembly", () => {
  it("buckets by volatility: shared before mode before conditional, then skills index", async () => {
    const sp = await makeService();
    sp.setBase("BASE");
    sp.registerFragment({ id: "c1", when: () => true, render: () => "COND1" });
    sp.registerFragment({ id: "m1", modes: ["creation"], order: 5, render: () => "MODE-B" });
    sp.registerFragment({ id: "m0", modes: ["creation", "default"], order: 1, render: () => "MODE-A" });
    sp.registerFragment({ id: "s1", render: () => "SHARED" });
    const out = sp.build([], { activeMode: "creation", traits: {} });
    expect(out.indexOf("SHARED")).toBeLessThan(out.indexOf("MODE-A"));
    expect(out.indexOf("MODE-A")).toBeLessThan(out.indexOf("MODE-B"));
    expect(out.indexOf("MODE-B")).toBeLessThan(out.indexOf("COND1"));
    expect(out.startsWith("BASE")).toBe(true);
  });

  it("mode fragments load only for the active mode; when-gated fragments respect traits", async () => {
    const sp = await makeService();
    sp.registerFragment({ id: "m", modes: ["creation"], render: () => "CREATION-ONLY" });
    sp.registerFragment({ id: "w", when: (t) => t["test"] === "vitest", render: () => "VITEST" });
    expect(sp.build([], { activeMode: "default", traits: {} })).not.toContain("CREATION-ONLY");
    expect(sp.build([], { activeMode: "default", traits: { test: "vitest" } })).toContain("VITEST");
    expect(sp.build([], { activeMode: "default", traits: {} })).not.toContain("VITEST");
  });

  it("byte-identical for identical inputs; mode switch preserves the shared prefix", async () => {
    const sp = await makeService();
    sp.setBase("BASE");
    sp.registerFragment({ id: "s", render: () => "SHARED" });
    sp.registerFragment({ id: "m", modes: ["default"], render: () => "DEFAULT" });
    sp.registerFragment({ id: "m2", modes: ["creation"], render: () => "CREATION" });
    const a1 = sp.build([], { activeMode: "default", traits: {} });
    const a2 = sp.build([], { activeMode: "default", traits: {} });
    expect(a1).toBe(a2);
    const c = sp.build([], { activeMode: "creation", traits: {} });
    const sharedPrefix = "BASE\n\nSHARED";
    expect(a1.startsWith(sharedPrefix)).toBe(true);
    expect(c.startsWith(sharedPrefix)).toBe(true);
  });

  it("sorts within a bucket by (order, id) and skips empty renders", async () => {
    const sp = await makeService();
    sp.registerFragment({ id: "b", order: 2, render: () => "B" });
    sp.registerFragment({ id: "a", order: 2, render: () => "A" });
    sp.registerFragment({ id: "z", order: 1, render: () => "" });
    const out = sp.build([], { activeMode: "default", traits: {} });
    expect(out).toBe("A\n\nB"); // z 渲染为空被跳过；同 order 按 id 升序
  });

  it("defaults ctx to {activeMode:'default', traits:{}}", async () => {
    const sp = await makeService();
    sp.registerFragment({ id: "m", modes: ["default"], render: () => "OK" });
    expect(sp.build([])).toContain("OK");
  });
});

describe("buildWithSegments", () => {
  it("with skills: text === build() === prompt + skillIndexText, and the index lives only in the skill segment", async () => {
    const ctx = await withPrompt();
    ctx.systemPrompt.setBase("BASE");
    const skills = [skill("review", "代码审查指南")];
    const whole = ctx.systemPrompt.build(skills);
    const seg = ctx.systemPrompt.buildWithSegments(skills);
    expect(seg.text).toBe(whole);
    expect(seg.text).toBe(seg.prompt + seg.skillIndexText);
    expect(seg.skillIndexText.length).toBeGreaterThan(0);
    expect(seg.prompt).toBe(ctx.systemPrompt.build([]));
    expect(seg.prompt).not.toContain("代码审查指南");
    expect(seg.skillIndexText).toContain("- review: 代码审查指南");
  });

  it("with no skills: skillIndexText is empty and text === build()", async () => {
    const ctx = await withPrompt();
    ctx.systemPrompt.setBase("BASE");
    const seg = ctx.systemPrompt.buildWithSegments([]);
    expect(seg.skillIndexText).toBe("");
    expect(seg.text).toBe(ctx.systemPrompt.build([]));
    expect(seg.text).toBe(seg.prompt);
  });

  it("keeps empty base + no fragments + no skills fully empty", async () => {
    const ctx = await withPrompt();
    const seg = ctx.systemPrompt.buildWithSegments([]);
    expect(seg.text).toBe("");
    expect(seg.prompt).toBe("");
    expect(seg.skillIndexText).toBe("");
  });

  it("keeps segments identical under an explicit ctx with fragments", async () => {
    const sp = await makeService();
    sp.setBase("BASE");
    sp.registerFragment({ id: "m", modes: ["creation"], render: () => "MODE" });
    const cctx = { activeMode: "creation", traits: {} } as const;
    const skills = [skill("review", "代码审查指南")];
    const seg = sp.buildWithSegments(skills, cctx);
    expect(seg.text).toBe(sp.build(skills, cctx));
    expect(seg.text).toBe(seg.prompt + seg.skillIndexText);
    expect(seg.prompt).toContain("MODE");
  });
});
