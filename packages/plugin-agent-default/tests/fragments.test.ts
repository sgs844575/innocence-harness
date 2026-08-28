import { describe, expect, it } from "vitest";
import { communicationFragments } from "../src/fragments/communication";
import { safetyFragments } from "../src/fragments/safety";

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
