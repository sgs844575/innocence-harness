import { describe, expect, it } from "vitest";
import { Context } from "@innocenceharness/kernel";
import { ToolsPlugin } from "@innocenceharness/harness-tools";
import { AgentsPlugin } from "@innocenceharness/harness-agent";
import { SystemPromptPlugin } from "@innocenceharness/harness-system-prompt";
import AutoModePlugin, { autoModeFragments } from "../src";

// `ctx.plugin` never runs plugin code synchronously (kernel fiber contract),
// so the helper awaits each load before touching the services.
async function setup(): Promise<Context> {
  const ctx = new Context();
  await ctx.plugin(ToolsPlugin);
  await ctx.plugin(AgentsPlugin);
  await ctx.plugin(SystemPromptPlugin);
  await ctx.plugin(AutoModePlugin);
  return ctx;
}

describe("auto agent mode", () => {
  it("registers the auto mode definition", async () => {
    expect((await setup()).agents.byId("auto")?.title).toBe("Auto");
  });

  it("mode fragments load only for the active mode", async () => {
    const ctx = await setup();
    const asAuto = ctx.systemPrompt.build([], { activeMode: "auto", traits: {} });
    const asDefault = ctx.systemPrompt.build([], { activeMode: "default", traits: {} });
    const asCreation = ctx.systemPrompt.build([], { activeMode: "creation", traits: {} });
    expect(asAuto.length).toBeGreaterThan(asDefault.length);
    expect(asDefault).not.toContain(asAuto.slice(60)); // 模式片段不进 default（前 60 字符可能是 base/共享头）
    expect(asDefault).not.toMatch(/# Auto Mode/);
    expect(asCreation).not.toMatch(/# Auto Mode/);
  });

  it("is English and free of banned tokens", async () => {
    const text = (await setup()).systemPrompt.build([], { activeMode: "auto", traits: {} });
    expect(text).not.toMatch(/[\u4e00-\u9fff]/);
    for (const re of [/Claude/i, /Anthropic/i, /OpenAI/i, /ChatGPT/i, /Codex/i, /Gemini/i]) {
      expect(text).not.toMatch(re);
    }
  });
});

// 七簇必点锚点（批次 4D 任务 3）：自主推进/持久化、周期自检、步频自觉、
// 通知礼仪、心跳降级、来源信任、设置建议。英文/禁词/中文纪律由上面
// "is English and free of banned tokens"（build 全文扫描）一并覆盖。
// 多词锚点用 \s+ 连接：片段正文按 ~72 列硬换行，词组可能跨行。
describe("auto persona required clusters", () => {
  const persona = autoModeFragments.find((fragment) => fragment.id === "auto.persona");
  const text = persona?.render({ activeMode: "auto", traits: {} }) ?? "";

  it("contributes exactly one auto-tagged persona fragment", () => {
    expect(persona, '缺少片段 "auto.persona"').toBeDefined();
    expect(persona).toMatchObject({ order: 2000, modes: ["auto"] });
    expect(autoModeFragments).toHaveLength(1);
  });

  it("keeps the persona within the briefed 250-350 word budget", () => {
    const words = text.split(/\s+/).filter((w) => w.length > 0).length;
    expect(words).toBeGreaterThanOrEqual(250);
    expect(words).toBeLessThanOrEqual(350);
  });

  it("covers autonomous advancement with persisted, resumable state", () => {
    for (const anchor of [/without\s+asking/i, /list\s+file/i, /resume/i]) {
      expect(text, `自主推进锚点缺失：${anchor}`).toMatch(anchor);
    }
  });

  it("covers the periodic progress checkpoint and block handling", () => {
    for (const anchor of [/reconcile|take\s+stock/i, /drift/i, /blocked/i, /set\s+the\s+item\s+aside/i]) {
      expect(text, `周期自检锚点缺失：${anchor}`).toMatch(anchor);
    }
  });

  it("covers output-aware pacing (press on / slow down)", () => {
    for (const anchor of [/cadence/i, /nothing\s+tangible/i, /slow\s+down/i]) {
      expect(text, `步频自觉锚点缺失：${anchor}`).toMatch(anchor);
    }
  });

  it("covers notification etiquette (milestones, immediate failure reports)", () => {
    for (const anchor of [/notify|notification/i, /milestones/i, /failure/i, /quietly\s+retry/i]) {
      expect(text, `通知礼仪锚点缺失：${anchor}`).toMatch(anchor);
    }
  });

  it("covers heartbeat degradation instead of feigned activity", () => {
    for (const anchor of [/heartbeat/i, /feigning\s+activity/i]) {
      expect(text, `心跳降级锚点缺失：${anchor}`).toMatch(anchor);
    }
  });

  it("covers source trust for relayed external content", () => {
    for (const anchor of [/not\s+commands/i, /cannot\s+vouch/i]) {
      expect(text, `来源信任锚点缺失：${anchor}`).toMatch(anchor);
    }
  });

  it("covers the one-line setup proposal before automating", () => {
    expect(text).toMatch(/setup\s+proposal/i);
    expect(text).toMatch(/goal,\s+interval,\s+and\s+stop\s+condition/i);
  });
});
