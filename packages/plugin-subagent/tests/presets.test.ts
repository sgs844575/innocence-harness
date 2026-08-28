import { describe, expect, it } from "vitest";
import { BUILTIN_PRESETS, createSubagentPlugin, createTaskTool, SubagentPlugin } from "../src";

describe("subagent presets", () => {
  it("built-in presets are English read-only/all pairs with unique ids", () => {
    const ids = BUILTIN_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    const explore = BUILTIN_PRESETS.find((p) => p.id === "explore");
    expect(explore?.tools).toBe("readOnly");
    expect(BUILTIN_PRESETS.find((p) => p.id === "general")?.tools).toBe("all");
    for (const p of BUILTIN_PRESETS) {
      expect(p.systemPrompt).toMatch(/[A-Za-z]{3,}/);
      for (const re of [/Claude/i, /Anthropic/i, /OpenAI/i, /ChatGPT/i, /Codex/i, /Gemini/i]) {
        expect(`${p.id}:${p.systemPrompt}`).not.toMatch(re);
      }
      expect(p.systemPrompt).not.toMatch(/[\u4e00-\u9fff]/); // 英文人设
      expect(p.title.length).toBeGreaterThan(0);
      expect(p.description.length).toBeGreaterThan(0);
    }
  });

  it("task tool derives agentType enum and description from the registry", () => {
    const tool = createTaskTool(BUILTIN_PRESETS);
    const properties = tool.parameters.properties as
      | Record<string, { enum?: string[] }>
      | undefined;
    const agentType = properties?.agentType;
    expect(agentType?.enum).toEqual(["explore", "general"]);
    expect(tool.description).toContain("explore");
    expect(tool.description).toContain("general");
  });

  it("executes with the preset systemPrompt and tool policy", async () => {
    const seen: Array<Record<string, unknown>> = [];
    const tool = createTaskTool(BUILTIN_PRESETS);
    const ctx = {
      signal: new AbortController().signal,
      subagent: {
        run: async (options: Record<string, unknown>) => {
          seen.push(options);
          return { finalText: "done", completion: { finishReason: "stop" } };
        },
      },
    };
    await tool.execute({ agentType: "explore", prompt: "research x" }, ctx as never);
    await tool.execute({ agentType: "general", prompt: "do x" }, ctx as never);
    expect(seen[0].systemPrompt).toBe(BUILTIN_PRESETS.find((p) => p.id === "explore")?.systemPrompt);
    expect(seen[0].tools).toBe("readOnly");
    expect(seen[1].tools).toBe("all");
  });

  it("rejects unknown agentType values listing valid ids", async () => {
    const tool = createTaskTool(BUILTIN_PRESETS);
    await expect(tool.validateArgs!({ agentType: "nope", prompt: "x" })).rejects.toThrow(/explore/);
  });

  it("createSubagentPlugin merges extra presets with override-by-id semantics", () => {
    const custom = { id: "custom", title: "C", description: "d", systemPrompt: "S", tools: "all" as const };
    const plugin = createSubagentPlugin({ extraPresets: [custom] });
    const registered: unknown[] = [];
    plugin.apply({ tools: { register: (t: unknown) => registered.push(t) } } as never);
    const enumValues = (registered[0] as { parameters: { properties: { agentType: { enum: string[] } } } })
      .parameters.properties.agentType.enum;
    expect(enumValues).toContain("custom");
  });

  it("default plugin exposes the full seven-preset catalog in the Task enum", () => {
    const registered: unknown[] = [];
    SubagentPlugin.apply({ tools: { register: (t: unknown) => registered.push(t) } } as never);
    const enumValues = (registered[0] as { parameters: { properties: { agentType: { enum: string[] } } } })
      .parameters.properties.agentType.enum;
    expect(enumValues).toEqual([
      "explore", "general", "code-review", "security-review", "planner", "git-worker", "simplify",
    ]);
  });
});
