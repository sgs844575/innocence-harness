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
  it("registers fifteen skills with unique names", () => {
    const names = builtinSkills.map((s) => s.name);
    expect(new Set(names).size).toBe(15);
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
      "memory-upkeep",
      "autonomous-loop",
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

  it("registers all fifteen on the skills service in order", async () => {
    const ctx = await setup();
    expect(ctx.skills.all().map((s) => s.name)).toEqual(
      builtinSkills.map((s) => s.name),
    );
  });

  it("tolerates name collisions: earlier registration wins, apply never throws", async () => {
    const ctx = await setup(true);
    const debugging = ctx.skills.get("debugging");
    expect(await debugging?.loadBody()).toBe("disk body");
    expect(ctx.skills.all().map((s) => s.name)).toHaveLength(15);
  });

  it("is English and free of banned tokens", () => {
    for (const s of builtinSkills) {
      expect(s.body).not.toMatch(/[\u4e00-\u9fff]/);
      for (const re of [/Claude/i, /Anthropic/i, /OpenAI/i, /ChatGPT/i, /Codex/i, /Gemini/i]) {
        expect(`${s.name}:${s.description}:${s.body}`).not.toMatch(re);
      }
    }
  });

  it("memory-upkeep carries the merge, mark-not-delete, index-health and attachment anchors", () => {
    const skill = builtinSkills.find((s) => s.name === "memory-upkeep");
    expect(skill).toBeDefined();
    // 合并重复/相近条目。
    expect(skill!.body).toMatch(/merge/i);
    // 过期清理取标注而非删除（无删除工具，历史依据保留）。
    expect(skill!.body).toMatch(/outdated|superseded/i);
    // 经工具面操作（读列写三件）。
    expect(skill!.body).toMatch(/memory_list/);
    expect(skill!.body).toMatch(/memory_write/);
    // 索引健康：id 语义化与首行信息密集。
    expect(skill!.body).toMatch(/first line/i);
    expect(skill!.body).toMatch(/\bid\b/);
    // 附件选择启发式：宁少勿滥。
    expect(skill!.body).toMatch(/fewer|sparing/i);
    // 建议周期：会话结束/用户要求。
    expect(skill!.body).toMatch(/session ends|wrap|user asks/i);
  });

  it("autonomous-loop carries the setup, pacing, monitoring, scheduling and local-cost anchors", () => {
    const skill = builtinSkills.find((s) => s.name === "autonomous-loop");
    expect(skill).toBeDefined();
    // 建立循环：清单文件约定（标题 + 复选列表）与本仓路径。
    expect(skill!.body).toMatch(/\.innocence\/loop\.md/);
    expect(skill!.body).toMatch(/title/);
    expect(skill!.body).toMatch(/checkbox/);
    // 每轮处理首个未勾项并在文件内打勾（文件即进度记录）。
    expect(skill!.body).toMatch(/unticked/);
    expect(skill!.body).toMatch(/marks\s+it\s+done/);
    // 经设置面创建自动化定义：目标会话、loop 载荷（清单 + 步频）。
    expect(skill!.body).toMatch(/automation\s+configuration\s+view|automation\s+definition/i);
    expect(skill!.body).toMatch(/target\s+session/);
    expect(skill!.body).toMatch(/loop\s+payload/);
    expect(skill!.body).toMatch(/pacing/);
    // 间隔选择起点：短任务分钟级、长任务小时级；可立即首跑。
    expect(skill!.body).toMatch(/minutes/);
    expect(skill!.body).toMatch(/hours/);
    expect(skill!.body).toMatch(/immediately/);
    // 停止条件先行：全完成 / 错误上限 / 手动停用。
    expect(skill!.body).toMatch(/stop\s+conditions?/);
    expect(skill!.body).toMatch(/all\s+entries\s+ticked/);
    expect(skill!.body).toMatch(/error\s+ceiling/);
    // 自步频：有产出收紧、无产出拉长，上下限钳制（本仓 pacing 语义）。
    expect(skill!.body).toMatch(/productive/);
    expect(skill!.body).toMatch(/floor/);
    expect(skill!.body).toMatch(/ceiling/);
    // 为什么：成本 / 噪声 / 避免空转。
    expect(skill!.body).toMatch(/cost/);
    expect(skill!.body).toMatch(/noise/);
    expect(skill!.body).toMatch(/\bspin\b/);
    // 监控与终止：周期查看进度；条件满足即停用。
    expect(skill!.body).toMatch(/progress/);
    expect(skill!.body).toMatch(/disable the definition/);
    // 异常时的退避预期。
    expect(skill!.body).toMatch(/backoff/);
    // 调度语义：间隔式（everyMs/idle）非完整 cron；复杂日历调度不支持，如实说明。
    expect(skill!.body).toMatch(/interval-based/);
    expect(skill!.body).toMatch(/milliseconds/);
    expect(skill!.body).toMatch(/idle/);
    expect(skill!.body).toMatch(/cron/);
    expect(skill!.body).toMatch(/not supported/);
    // 本地运行注意：配额与上下文消耗、长循环的会话压缩影响。
    expect(skill!.body).toMatch(/quota/);
    expect(skill!.body).toMatch(/context/);
    expect(skill!.body).toMatch(/compaction/);
  });
});
