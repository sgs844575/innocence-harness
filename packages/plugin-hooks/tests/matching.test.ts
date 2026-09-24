// Matching semantics unit tests: literal branches stay per-face (equality,
// prefix, always-true), the regex branch searches unanchored, and an
// uncompilable pattern (unreachable via the parser, still guarded) matches
// nothing instead of throwing.
import { describe, expect, it } from "vitest";
import type { HookDefinition } from "../src/config";
import { hookMatchesSubject } from "../src/matching";

function hookWith(match: string | undefined, matchKind?: "regex"): HookDefinition {
  return { event: "preToolCall", command: "x", ...(match !== undefined ? { match, ...(matchKind ? { matchKind } : {}) } : {}) };
}

describe("hookMatchesSubject", () => {
  it("treats an absent match as always matching", () => {
    expect(hookMatchesSubject(hookWith(undefined), "anything", () => false)).toBe(true);
  });

  it("delegates literal matches to the caller's face", () => {
    const hook = hookWith("Write");
    expect(hookMatchesSubject(hook, "Write", (m) => m === "Write")).toBe(true);
    expect(hookMatchesSubject(hook, "Edit", (m) => m === "Edit")).toBe(false);
    expect(hookMatchesSubject(hookWith("review"), "please review this", (m) => m.startsWith("review"))).toBe(true);
  });

  it("searches regex matchers unanchored over the subject", () => {
    const hook = hookWith("startup|clear|compact", "regex");
    expect(hookMatchesSubject(hook, "startup", () => true)).toBe(true);
    expect(hookMatchesSubject(hook, "resume", () => true)).toBe(false);
    expect(hookMatchesSubject(hookWith("Write|Edit", "regex"), "Edit", () => false)).toBe(true);
  });

  it("matches nothing when the pattern cannot compile", () => {
    expect(hookMatchesSubject(hookWith("Bash(", "regex"), "Bash(", () => true)).toBe(false);
  });
});
