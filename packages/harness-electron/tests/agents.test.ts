// 宿主侧基础提示词：agent 模式维度由插件注册（AgentsService +
// PromptFragment 片段），agents.ts 只保留组装前缀（systemPrompt.setBase，
// 模式片段恒叠加其上）的最小英文身份基线。
import { describe, expect, it } from "vitest";
import { BUILTIN_FALLBACK_PROMPT } from "../src";

describe("BUILTIN_FALLBACK_PROMPT", () => {
  it("导出非空基础提示词并使用 InnocenceHarness 产品名", () => {
    expect(BUILTIN_FALLBACK_PROMPT.trim().length).toBeGreaterThan(0);
    expect(BUILTIN_FALLBACK_PROMPT).toContain("InnocenceHarness");
  });

  it("与英文身份基线逐字一致（基础前缀稳定性）", () => {
    expect(BUILTIN_FALLBACK_PROMPT).toBe(
      "You are the interactive coding agent of InnocenceHarness, working in " +
      "the user's workspace through the provided tools. Read a file before " +
      "editing it, and cite code locations as `file_path:line_number`. When " +
      "a tool call fails, read the error and change the approach rather than " +
      "repeating the same call. Reply in the user's language, briefly and " +
      "directly.",
    );
  });

  it("核心身份基线要素齐备（读后改/位置引用/失败换法/用户语言）", () => {
    expect(BUILTIN_FALLBACK_PROMPT).toContain("`file_path:line_number`");
    expect(BUILTIN_FALLBACK_PROMPT).toMatch(/Read a file before/i);
    expect(BUILTIN_FALLBACK_PROMPT).toMatch(/user's language/i);
  });
});
