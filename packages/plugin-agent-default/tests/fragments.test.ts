import { describe, expect, it } from "vitest";
import { conditionalFragments } from "../src/fragments/conditional";
import * as clusters from "../src/index";
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

describe("conditional fragments & trademark sweep", () => {
  it("conditional cluster gates on traits", () => {
    const text = (traits: Record<string, string | undefined>) =>
      conditionalFragments.map((f) => f.render({ activeMode: "default", traits })).join("");
    expect(text({ test: "vitest" })).toMatch(/vitest/i);
    expect(text({})).not.toMatch(/vitest/i);
    expect(text({ os: "win32" })).toMatch(/PowerShell/i);
    expect(text({ os: "linux" })).not.toMatch(/PowerShell/i);
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
