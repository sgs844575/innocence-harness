import { describe, expect, it } from "vitest";
import { adaptedPresets, codingPresets } from "../src";

const all = [...adaptedPresets, ...codingPresets];

describe("adapted subagent presets", () => {
  it("exposes six well-formed presets with unique ids", () => {
    expect(adaptedPresets.map((p) => p.id)).toEqual([
      "code-review", "security-review", "planner", "git-worker", "simplify", "summarizer",
    ]);
  });
});

describe("coding subagent presets", () => {
  it("exposes four well-formed presets with unique ids", () => {
    expect(codingPresets.map((p) => p.id)).toEqual([
      "implementer", "test-engineer", "debugger", "perf-analyst",
    ]);
    expect(new Set(all.map((p) => p.id)).size).toBe(all.length);
    expect(codingPresets.find((p) => p.id === "implementer")?.tools).toBe("all");
    expect(codingPresets.find((p) => p.id === "test-engineer")?.tools).toBe("all");
    expect(codingPresets.find((p) => p.id === "debugger")?.tools).toBe("all");
    expect(codingPresets.find((p) => p.id === "perf-analyst")?.tools).toBe("readOnly");
  });
  it("carries the expected methodology anchors", () => {
    const text = Object.fromEntries(codingPresets.map((p) => [p.id, p.systemPrompt]));
    expect(text["implementer"]).toMatch(/smallest diff|smallest one/i);
    expect(text["test-engineer"]).toMatch(/characterization/i);
    expect(text["debugger"]).toMatch(/root cause/i);
    expect(text["perf-analyst"]).toMatch(/read-only/i);
  });
});

describe("all presets", () => {
  it("are well-formed prompts", () => {
    for (const p of all) {
      expect(p.title.length).toBeGreaterThan(0);
      expect(p.description.length).toBeGreaterThan(0);
      expect(["readOnly", "all"]).toContain(p.tools);
      expect(p.systemPrompt.length).toBeGreaterThan(400);
    }
  });
  it("stay English and free of banned tokens", () => {
    for (const p of all) {
      expect(p.systemPrompt).not.toMatch(/[\u4e00-\u9fff]/);
      for (const re of [/Claude/i, /Anthropic/i, /OpenAI/i, /ChatGPT/i, /Codex/i, /Gemini/i]) {
        expect(`${p.id}:${p.systemPrompt}`).not.toMatch(re);
      }
    }
  });
  it("adapted presets carry their methodology anchors", () => {
    const text = Object.fromEntries(adaptedPresets.map((p) => [p.id, p.systemPrompt]));
    expect(text["code-review"]).toMatch(/verif/i);
    expect(text["planner"]).toMatch(/read-only/i);
    expect(text["security-review"]).toMatch(/injection|OWASP/i);
    expect(text["git-worker"]).toMatch(/commit/i);
    expect(text["simplify"]).toMatch(/simplif/i);
    expect(text["summarizer"]).toMatch(/handover/i);
  });
});
