import { describe, expect, it } from "vitest";
import { parseEcosystemHooksDocument, MAX_HOOK_TIMEOUT_MS } from "../src";

describe("parseEcosystemHooksDocument", () => {
  it("maps every supported ecosystem event onto the native vocabulary", () => {
    const parsed = parseEcosystemHooksDocument({
      hooks: {
        PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "guard.sh" }] }],
        PostToolUse: [{ hooks: [{ type: "command", command: "after.sh" }] }],
        UserPromptSubmit: [{ hooks: [{ type: "command", command: "prompt.sh" }] }],
        SessionStart: [{ hooks: [{ type: "command", command: "start.sh" }] }],
        SessionStop: [{ hooks: [{ type: "command", command: "stop.sh" }] }],
        Stop: [{ hooks: [{ type: "command", command: "turn.sh" }] }],
      },
    });
    expect(parsed.warnings).toEqual([]);
    expect(parsed.hooks).toEqual([
      { event: "preToolCall", command: "guard.sh", match: "Bash" },
      { event: "postToolCall", command: "after.sh" },
      { event: "userPromptSubmit", command: "prompt.sh" },
      { event: "sessionStart", command: "start.sh" },
      { event: "sessionStop", command: "stop.sh" },
      { event: "turnEnd", command: "turn.sh" },
    ]);
  });

  it("accepts the embedded settings shape (event map at the top level)", () => {
    const parsed = parseEcosystemHooksDocument({ PreToolUse: [{ hooks: [{ type: "command", command: "x" }] }] });
    expect(parsed.hooks).toEqual([{ event: "preToolCall", command: "x" }]);
  });

  it("converts seconds to milliseconds and clamps at the ceiling with a warning", () => {
    const parsed = parseEcosystemHooksDocument({
      hooks: { Stop: [{ hooks: [
        { type: "command", command: "quick.sh", timeout: 5 },
        { type: "command", command: "slow.sh", timeout: 600 },
      ] }] },
    });
    expect(parsed.hooks).toEqual([
      { event: "turnEnd", command: "quick.sh", timeoutMs: 5000 },
      { event: "turnEnd", command: "slow.sh", timeoutMs: MAX_HOOK_TIMEOUT_MS },
    ]);
    expect(parsed.warnings).toHaveLength(1);
    expect(parsed.warnings[0]).toMatch(/clamped/);
  });

  it("skips unknown events, non-command hook types, and malformed entries with warnings", () => {
    const parsed = parseEcosystemHooksDocument({
      hooks: {
        SubagentStop: [{ hooks: [{ type: "command", command: "x" }] }],
        PreCompact: [{ hooks: [{ type: "command", command: "x" }] }],
        PreToolUse: [
          { hooks: [{ type: "remote", command: "y" }, {}, { type: "command", command: "" }] },
          "not-an-object",
          { hooks: [] },
        ],
      },
    });
    expect(parsed.hooks).toEqual([]);
    expect(parsed.warnings).toEqual([
      'ecosystem hook event "SubagentStop" has no mapping; skipped',
      'ecosystem hook event "PreCompact" has no mapping; skipped',
      'PreToolUse[0].hooks[0]: only "command" hooks are supported; skipped',
      'PreToolUse[0].hooks[1]: only "command" hooks are supported; skipped',
      "PreToolUse[0].hooks[2]: command must be a non-empty string",
      "PreToolUse[1]: matcher group must be an object",
      'PreToolUse[2]: matcher group needs a non-empty "hooks" array',
    ]);
  });

  it("warns when a matcher carries pattern characters (matched literally here)", () => {
    const parsed = parseEcosystemHooksDocument({
      hooks: { PreToolUse: [{ matcher: "Bash|Edit", hooks: [{ type: "command", command: "x" }] }] },
    });
    expect(parsed.hooks).toEqual([{ event: "preToolCall", command: "x", match: "Bash|Edit" }]);
    expect(parsed.warnings).toHaveLength(1);
  });

  it("rejects non-object documents outright", () => {
    expect(parseEcosystemHooksDocument("nope").warnings).toEqual([
      "ecosystem hooks document must be a JSON object",
    ]);
  });
});
