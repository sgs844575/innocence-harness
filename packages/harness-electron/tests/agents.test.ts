// 宿主侧回退提示词：agent 模式维度由插件注册（AgentsService +
// PromptFragment 片段），agents.ts 只保留"任何模式都未命中"时的最小 base
// （文本迁移自原 DEFAULT_SYSTEM_PROMPT，行为不变）。
import { describe, expect, it } from "vitest";
import { BUILTIN_FALLBACK_PROMPT } from "../src";

describe("BUILTIN_FALLBACK_PROMPT", () => {
  it("导出非空回退提示词并使用 InnocenceHarness 产品名", () => {
    expect(BUILTIN_FALLBACK_PROMPT.trim().length).toBeGreaterThan(0);
    expect(BUILTIN_FALLBACK_PROMPT).toContain("InnocenceHarness");
  });

  it("文本与原 DEFAULT_SYSTEM_PROMPT 逐字一致（行为不变迁移）", () => {
    expect(BUILTIN_FALLBACK_PROMPT).toBe(
      "你是 InnocenceHarness 的编程助手。你可以调用工具读写工作区文件。\n" +
      "约定：引用代码位置用 `文件路径:行号`；修改文件前先 Read 确认原文；" +
      "工具失败时读取错误信息自行纠正，不要重复同样的失败调用；" +
      "回答用用户的语言，简洁直接。",
    );
  });
});
