import { describe, expect, it } from "vitest";
import { adaptedPresets } from "../src";

describe("adapted subagent presets", () => {
  it("exposes five well-formed presets with unique ids", () => {
    expect(adaptedPresets.map((p) => p.id)).toEqual([
      "code-review", "security-review", "planner", "git-worker", "simplify",
    ]);
    for (const p of adaptedPresets) {
      expect(p.title.length).toBeGreaterThan(0);
      expect(p.description.length).toBeGreaterThan(0);
      expect(["readOnly", "all"]).toContain(p.tools);
      expect(p.systemPrompt.length).toBeGreaterThan(400);
    }
  });
  it("stays English and free of banned tokens", () => {
    for (const p of adaptedPresets) {
      expect(p.systemPrompt).not.toMatch(/[\u4e00-\u9fff]/);
      for (const re of [/Claude/i, /Anthropic/i, /OpenAI/i, /ChatGPT/i, /Codex/i, /Gemini/i]) {
        expect(`${p.id}:${p.systemPrompt}`).not.toMatch(re);
      }
    }
  });
  it("carries the expected methodology anchors", () => {
    const text = Object.fromEntries(adaptedPresets.map((p) => [p.id, p.systemPrompt]));
    expect(text["code-review"]).toMatch(/verif/i);
    expect(text["planner"]).toMatch(/read-only/i);
    expect(text["security-review"]).toMatch(/injection|OWASP/i);
    expect(text["git-worker"]).toMatch(/commit/i);
    expect(text["simplify"]).toMatch(/simplif/i);
  });
});
