import { describe, expect, it } from "vitest";
import {
  parseEcosystemHooksDocument,
  tokenizeEcosystemCommand,
  MAX_HOOK_TIMEOUT_MS,
} from "../src";

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
      { event: "preToolCall", command: "guard.sh", commandTokens: ["guard.sh"], match: "Bash", matchKind: "regex" },
      { event: "postToolCall", command: "after.sh", commandTokens: ["after.sh"] },
      { event: "userPromptSubmit", command: "prompt.sh", commandTokens: ["prompt.sh"] },
      { event: "sessionStart", command: "start.sh", commandTokens: ["start.sh"] },
      { event: "sessionStop", command: "stop.sh", commandTokens: ["stop.sh"] },
      { event: "turnEnd", command: "turn.sh", commandTokens: ["turn.sh"] },
    ]);
  });

  it("accepts the embedded settings shape (event map at the top level)", () => {
    const parsed = parseEcosystemHooksDocument({ PreToolUse: [{ hooks: [{ type: "command", command: "x" }] }] });
    expect(parsed.hooks).toEqual([{ event: "preToolCall", command: "x", commandTokens: ["x"] }]);
  });

  it("converts seconds to milliseconds and clamps at the ceiling with a warning", () => {
    const parsed = parseEcosystemHooksDocument({
      hooks: { Stop: [{ hooks: [
        { type: "command", command: "quick.sh", timeout: 5 },
        { type: "command", command: "slow.sh", timeout: 600 },
      ] }] },
    });
    expect(parsed.hooks).toEqual([
      { event: "turnEnd", command: "quick.sh", commandTokens: ["quick.sh"], timeoutMs: 5000 },
      { event: "turnEnd", command: "slow.sh", commandTokens: ["slow.sh"], timeoutMs: MAX_HOOK_TIMEOUT_MS },
    ]);
    expect(parsed.warnings).toHaveLength(1);
    expect(parsed.warnings[0]).toMatch(/clamped/);
  });

  it("loads a regex matcher cleanly (the ecosystem matcher shape)", () => {
    const parsed = parseEcosystemHooksDocument({
      hooks: {
        SessionStart: [
          {
            matcher: "startup|clear|compact",
            hooks: [{ type: "command", command: '"${CLAUDE_PLUGIN_ROOT}/hooks/run-hook.cmd" session-start' }],
          },
        ],
      },
    }, { pluginRoot: "C:/plugins/skills-pack/1.7.8" });
    expect(parsed.warnings).toEqual([]);
    expect(parsed.hooks).toEqual([
      {
        event: "sessionStart",
        command: '"C:/plugins/skills-pack/1.7.8/hooks/run-hook.cmd" session-start',
        commandTokens: ["C:/plugins/skills-pack/1.7.8/hooks/run-hook.cmd", "session-start"],
        match: "startup|clear|compact",
        matchKind: "regex",
      },
    ]);
  });

  it("skips a syntactically invalid regex matcher with a warning", () => {
    const parsed = parseEcosystemHooksDocument({
      hooks: { PreToolUse: [{ matcher: "Bash(", hooks: [{ type: "command", command: "x" }] }] },
    });
    expect(parsed.hooks).toEqual([]);
    expect(parsed.warnings).toEqual([
      'PreToolUse[0]: matcher "Bash(" is not a valid regular expression; skipped',
    ]);
  });

  it("expands both plugin-root variable spellings with the optional fallback form", () => {
    const parsed = parseEcosystemHooksDocument({
      hooks: {
        Stop: [{ hooks: [
          { type: "command", command: "${PLUGIN_ROOT}/a.sh" },
          { type: "command", command: "${CLAUDE_PLUGIN_ROOT:-/fallback}/b.sh" },
        ] }],
      },
    }, { pluginRoot: "C:/plugins/p/1.0" });
    expect(parsed.warnings).toEqual([]);
    expect(parsed.hooks.map((hook) => hook.commandTokens)).toEqual([
      ["C:/plugins/p/1.0/a.sh"],
      ["C:/plugins/p/1.0/b.sh"],
    ]);
  });

  it("leaves the plugin-root placeholder verbatim when no root is provided", () => {
    const parsed = parseEcosystemHooksDocument({
      hooks: { Stop: [{ hooks: [{ type: "command", command: '"${CLAUDE_PLUGIN_ROOT}/run.sh" x' }] }] },
    });
    expect(parsed.hooks[0].command).toBe('"${CLAUDE_PLUGIN_ROOT}/run.sh" x');
    expect(parsed.hooks[0].commandTokens).toEqual(["${CLAUDE_PLUGIN_ROOT}/run.sh", "x"]);
  });

  it("skips a command with unterminated quoting", () => {
    const parsed = parseEcosystemHooksDocument({
      hooks: { Stop: [{ hooks: [{ type: "command", command: '"unterminated arg' }] }] },
    });
    expect(parsed.hooks).toEqual([]);
    expect(parsed.warnings).toEqual([
      "Stop[0].hooks[0]: command quoting is malformed; skipped",
    ]);
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

  it("rejects non-object documents outright", () => {
    expect(parseEcosystemHooksDocument("nope").warnings).toEqual([
      "ecosystem hooks document must be a JSON object",
    ]);
  });
});

describe("tokenizeEcosystemCommand", () => {
  it("splits on whitespace and strips quote segments", () => {
    expect(tokenizeEcosystemCommand('"C:/my dir/run.cmd" do it')).toEqual([
      "C:/my dir/run.cmd",
      "do",
      "it",
    ]);
    expect(tokenizeEcosystemCommand("'single quoted' plain")).toEqual([
      "single quoted",
      "plain",
    ]);
  });

  it("equals plain whitespace splitting when no quotes are present", () => {
    expect(tokenizeEcosystemCommand("node script.js --flag one")).toEqual([
      "node",
      "script.js",
      "--flag",
      "one",
    ]);
  });

  it("returns null for unterminated quotes", () => {
    expect(tokenizeEcosystemCommand('"open only')).toBeNull();
    expect(tokenizeEcosystemCommand("closed 'open")).toBeNull();
  });
});
