import { describe, expect, it } from "vitest";
import { communicationFragments } from "../src/fragments/communication";
import { safetyFragments } from "../src/fragments/safety";
import { taskDisciplineFragments } from "../src/fragments/taskDiscipline";
import { toolPolicyFragments } from "../src/fragments/toolPolicy";
import { subagentFragments } from "../src/fragments/subagents";

describe("shared fragment clusters", () => {
  it("communication cluster is mode-agnostic and ordered", () => {
    for (const f of communicationFragments) {
      expect(f.modes).toBeUndefined();
      expect(f.when).toBeUndefined();
      expect(f.id.startsWith("shared.communication.")).toBe(true);
    }
  });
  it("safety cluster is mode-agnostic", () => {
    for (const f of safetyFragments) expect(f.id.startsWith("shared.safety.")).toBe(true);
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
