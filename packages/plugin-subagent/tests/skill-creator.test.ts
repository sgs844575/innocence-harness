import { expect, it, vi } from "vitest";
import { BUILTIN_PRESETS, createTaskTool } from "../src";
it("registers and dispatches the skill creator with writable tools", async () => {
  const run = vi.fn(async () => ({ finalText: "Created workflow" }));
  const tool = createTaskTool(BUILTIN_PRESETS, () => [{ name: "Read", readOnly: true }, { name: "Write" }]);
  await tool.execute({ agentType: "skills-creator", prompt: "Create a review skill in /workspace/.innocence/skills" }, { signal: new AbortController().signal, subagent: { run } } as never);
  expect(run).toHaveBeenCalledWith(expect.objectContaining({ tools: "all", systemPrompt: expect.stringContaining("skill creation specialist") }));
});
