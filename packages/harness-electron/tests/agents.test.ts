// 宿主侧基础提示词：agent 模式维度由插件注册（AgentsService +
// PromptFragment 片段），agents.ts 只保留组装前缀（systemPrompt.setBase，
// 模式片段恒叠加其上）的最小英文身份基线 + 执行工作流纪律（前缀叠加进
// 每个 agent 模式的提示词，一处修改全模式生效）。
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
      "directly.\n\n" +
      "Execution workflow, for every task you carry out: first analyze the " +
      "requirement (what is being asked, what the code actually does, what the " +
      "acceptance looks like), then lay out the steps as a todo list with the " +
      "TodoWrite tool, then execute strictly by that list — marking items " +
      "complete as you finish them and adding newly discovered steps instead of " +
      "working from memory. Trivial one-step requests need no list.\n\n" +
      "Plan with capabilities in mind: as you shape the todo steps, match each " +
      "step to the right capability instead of doing everything by hand. " +
      "Prefer delegating self-contained or parallelizable work to subagents " +
      "(the Task tool); reuse what relevant memory holds; and pick the MCP " +
      "tools, plugin capabilities, skills (/name), commands, and declared " +
      "hooks that fit the job. An existing capability beats a hand-rolled " +
      "equivalent.",
    );
  });

  it("核心身份基线要素齐备（读后改/位置引用/失败换法/用户语言）", () => {
    expect(BUILTIN_FALLBACK_PROMPT).toContain("`file_path:line_number`");
    expect(BUILTIN_FALLBACK_PROMPT).toMatch(/Read a file before/i);
    expect(BUILTIN_FALLBACK_PROMPT).toMatch(/user's language/i);
  });

  it("执行工作流纪律齐备（先分析、列 todo、按 todo 执行）", () => {
    expect(BUILTIN_FALLBACK_PROMPT).toMatch(/first analyze the requirement/i);
    expect(BUILTIN_FALLBACK_PROMPT).toMatch(/todo list with the TodoWrite tool/i);
    expect(BUILTIN_FALLBACK_PROMPT).toMatch(/execute strictly by that list/i);
    expect(BUILTIN_FALLBACK_PROMPT).toMatch(/marking items complete/i);
  });

  it("能力匹配纪律齐备（子代理推荐/记忆/MCP/插件/技能/命令/钩子）", () => {
    expect(BUILTIN_FALLBACK_PROMPT).toMatch(/Plan with capabilities in mind/i);
    expect(BUILTIN_FALLBACK_PROMPT).toMatch(/Prefer delegating .* to subagents \(the Task tool\)/i);
    expect(BUILTIN_FALLBACK_PROMPT).toMatch(/reuse what relevant memory holds/i);
    expect(BUILTIN_FALLBACK_PROMPT).toContain("MCP tools, plugin capabilities, skills (/name), commands, and declared hooks");
  });
});
