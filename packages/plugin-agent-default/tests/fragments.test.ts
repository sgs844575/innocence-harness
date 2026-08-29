import { describe, expect, it } from "vitest";
import { conditionalFragments } from "../src/fragments/conditional";
import * as clusters from "../src/index";
import { communicationFragments } from "../src/fragments/communication";
import { safetyFragments } from "../src/fragments/safety";
import { taskDisciplineFragments } from "../src/fragments/taskDiscipline";
import { toolPolicyFragments } from "../src/fragments/toolPolicy";
import { subagentFragments } from "../src/fragments/subagents";
import { memoryFragments } from "../src/fragments/memory";

describe("shared fragment clusters", () => {
  it("communication cluster is mode-agnostic and ordered", () => {
    for (const f of communicationFragments) {
      expect(f.modes).toBeUndefined();
      expect(f.when).toBeUndefined();
      expect(f.id.startsWith("shared.communication.")).toBe(true);
    }
  });
  it("correction-restraint fragment sits in the shared bucket and mounts for every mode", () => {
    const fragment = communicationFragments.find((f) => f.id === "shared.communication.correction");
    expect(fragment).toBeDefined();
    expect(fragment!.order).toBe(1030);
    expect(fragment!.modes).toBeUndefined();
    expect(fragment!.when).toBeUndefined();
    for (const mode of ["default", "creation"]) {
      const text = fragment!.render({ activeMode: mode, traits: {} });
      expect(text).not.toMatch(/[\u4e00-\u9fff]/); // 英文正文
      expect(text).toMatch(/rejected/i); // 已否决方案不重提
      expect(text).toMatch(/correction/i);
      for (const re of [/Claude/i, /Anthropic/i, /OpenAI/i, /ChatGPT/i, /Codex/i, /Gemini/i]) {
        expect(text).not.toMatch(re);
      }
    }
  });
  it("safety cluster is mode-agnostic", () => {
    for (const f of safetyFragments) expect(f.id.startsWith("shared.safety.")).toBe(true);
  });
  it("memory discipline fragment sits in the shared bucket and mounts for every mode", () => {
    const fragment = memoryFragments.find((f) => f.id === "shared.memory.discipline");
    expect(fragment).toBeDefined();
    expect(fragment!.order).toBe(1120);
    expect(fragment!.modes).toBeUndefined();
    expect(fragment!.when).toBeUndefined();
    // 注册面：进默认模式插件的聚合导出（共享桶对全部模式生效）。
    expect(clusters.defaultModeFragments.map((f) => f.id)).toContain("shared.memory.discipline");
    for (const mode of ["default", "creation"]) {
      const text = fragment!.render({ activeMode: mode, traits: {} });
      expect(text).not.toMatch(/[\u4e00-\u9fff]/); // 英文正文
      for (const re of [/Claude/i, /Anthropic/i, /OpenAI/i, /ChatGPT/i, /Codex/i, /Gemini/i]) {
        expect(text).not.toMatch(re);
      }
    }
  });
  it("memory discipline fragment carries the save-time, exclusion, shape and retrieval anchors", () => {
    const text = memoryFragments
      .find((f) => f.id === "shared.memory.discipline")!
      .render({ activeMode: "default", traits: {} });
    // 何时存：用户更正/偏好 + 项目持久约束 + 反复决策依据。
    expect(text).toMatch(/correct/i);
    expect(text).toMatch(/preference/i);
    expect(text).toMatch(/constraint/i);
    // 排除：密钥凭据 / 瞬态任务态归 TodoWrite / 计划是会话工件。
    expect(text).toMatch(/secret|credential/i);
    expect(text).toContain("TodoWrite");
    expect(text).toMatch(/plan/i);
    // 形态：id 语义化 / 描述行信息密集 / 覆写更新。
    expect(text).toMatch(/\bid\b/);
    expect(text).toMatch(/description\s+line/i);
    expect(text).toMatch(/overwrit/i);
    // 取用：查索引 + memory_read 取正文。
    expect(text).toMatch(/memory_read/);
    expect(text).toMatch(/index/i);
  });
  it("renders contain no banned third-party tokens", () => {
    const banned = [/Claude/i, /Anthropic/i, /OpenAI/i, /ChatGPT/i, /Codex/i];
    for (const f of [...communicationFragments, ...safetyFragments]) {
      const text = f.render({ activeMode: "default", traits: {} });
      for (const re of banned) expect(text).not.toMatch(re);
    }
  });
});

describe("default-mode fragment clusters", () => {
  it("mode clusters are tagged default-only", () => {
    for (const f of [...taskDisciplineFragments, ...toolPolicyFragments, ...subagentFragments]) {
      expect(f.modes).toContain("default");
    }
  });
  it("tool policy references the real harness tool names and no foreign ones", () => {
    const text = toolPolicyFragments.map((f) => f.render({ activeMode: "default", traits: {} })).join("\n");
    for (const name of ["Read", "Write", "Edit", "Glob", "Grep", "Bash", "TodoWrite", "Task"]) {
      expect(text).toContain(name);
    }
    expect(text).not.toMatch(/NotebookEdit|WebFetch|WebSearch|Computer\b/);
  });
});

describe("conditional fragments & trademark sweep", () => {
  it("conditional cluster gates on traits", () => {
    const text = (traits: Record<string, string | undefined>) =>
      conditionalFragments.map((f) => f.render({ activeMode: "default", traits })).join("");
    expect(text({ test: "vitest" })).toMatch(/vitest/i);
    expect(text({})).not.toMatch(/vitest/i);
    expect(text({ os: "win32" })).toMatch(/Windows shell/i);
    expect(text({ os: "linux" })).not.toMatch(/Windows shell/i);
  });
  it("all exported fragments stay free of banned tokens across modes and trait sets", () => {
    const banned = [/Claude/i, /Anthropic/i, /OpenAI/i, /ChatGPT/i, /Codex/i, /Gemini/i];
    const ctxs = [
      { activeMode: "default", traits: {} },
      { activeMode: "creation", traits: {} },
      { activeMode: "default", traits: { test: "vitest", os: "win32", monorepo: "workspaces", framework: "electron" } },
    ];
    for (const f of clusters.defaultModeFragments) for (const c of ctxs) {
      const text = f.render(c);
      for (const re of banned) expect(`${f.id}: ${text}`).not.toMatch(re);
    }
  });
});
