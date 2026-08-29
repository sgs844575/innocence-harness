// plugin-hooks config tests (batch 4C task 1 + task 2 trim fix): declarative
// hook array parsing — the four-event enum gate, command/match/timeout
// validation, ceiling clamping with a warning, skip-and-warn degradation
// for bad entries, duplicate preservation, and the factory plugin skeleton
// (task 2 wires apply through the session faces).
import type { Context } from "@innocenceharness/kernel";
import type { MessageProcessor } from "@innocenceharness/harness-session";
import type { ToolExecutionMiddleware } from "@innocenceharness/harness-tools";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_HOOK_TIMEOUT_MS,
  MAX_HOOK_TIMEOUT_MS,
  parseHookDefinitions,
} from "../src/config";
import { createHooksPlugin } from "../src";
import hooksDefault from "../src";

describe("parseHookDefinitions", () => {
  it("parses a valid array covering all four events", () => {
    const parsed = parseHookDefinitions([
      { event: "userPromptSubmit", command: "inject-hook" },
      { event: "preToolCall", command: "guard-hook --mode strict", match: "Bash" },
      { event: "postToolCall", command: "after-hook", match: "Write", timeoutMs: 5000 },
      { event: "sessionStart", command: "boot-hook", timeoutMs: 30000 },
    ]);
    expect(parsed.warnings).toEqual([]);
    expect(parsed.hooks).toHaveLength(4);
    expect(parsed.hooks[0]).toEqual({
      event: "userPromptSubmit",
      command: "inject-hook",
    });
    expect(parsed.hooks[1]).toMatchObject({
      event: "preToolCall",
      command: "guard-hook --mode strict",
      match: "Bash",
    });
    expect(parsed.hooks[2]).toMatchObject({ timeoutMs: 5000 });
    expect(parsed.hooks[3]).toMatchObject({ event: "sessionStart", timeoutMs: 30000 });
  });

  it("keeps valid siblings while skipping entries with an unknown event", () => {
    const parsed = parseHookDefinitions([
      { event: "onStop", command: "stop-hook" },
      { event: "sessionStart", command: "boot-hook" },
    ]);
    expect(parsed.hooks).toEqual([{ event: "sessionStart", command: "boot-hook" }]);
    expect(parsed.warnings).toHaveLength(1);
    expect(parsed.warnings[0]).toContain("onStop");
  });

  it("rejects missing, blank and non-string commands", () => {
    const parsed = parseHookDefinitions([
      { event: "sessionStart" },
      { event: "sessionStart", command: "   " },
      { event: "sessionStart", command: 42 },
    ]);
    expect(parsed.hooks).toEqual([]);
    expect(parsed.warnings).toHaveLength(3);
  });

  it("skips non-object entries and wrong field types with warnings", () => {
    const parsed = parseHookDefinitions([
      42,
      null,
      ["not", "an", "object"],
      { event: "sessionStart", command: "boot-hook", match: 7 },
      { event: "sessionStart", command: "boot-hook", timeoutMs: "10000" },
    ]);
    expect(parsed.hooks).toEqual([]);
    expect(parsed.warnings).toHaveLength(5);
  });

  it("clamps timeoutMs above the ceiling and reports the clamped value", () => {
    const parsed = parseHookDefinitions([
      { event: "sessionStart", command: "boot-hook", timeoutMs: 60000 },
    ]);
    expect(parsed.hooks).toEqual([
      { event: "sessionStart", command: "boot-hook", timeoutMs: 30000 },
    ]);
    expect(parsed.warnings).toHaveLength(1);
    expect(parsed.warnings[0]).toContain("30000");
  });

  it("rejects non-positive or non-finite timeoutMs", () => {
    const parsed = parseHookDefinitions([
      { event: "sessionStart", command: "boot-hook", timeoutMs: 0 },
      { event: "sessionStart", command: "boot-hook", timeoutMs: Number.POSITIVE_INFINITY },
    ]);
    expect(parsed.hooks).toEqual([]);
    expect(parsed.warnings).toHaveLength(2);
  });

  it("trims the match value alongside the command", () => {
    const parsed = parseHookDefinitions([
      { event: "preToolCall", command: "  guard-hook  ", match: "  Write  " },
    ]);
    expect(parsed.warnings).toEqual([]);
    expect(parsed.hooks).toEqual([
      { event: "preToolCall", command: "guard-hook", match: "Write" },
    ]);
  });

  it("keeps duplicated commands across events without deduplication", () => {
    const parsed = parseHookDefinitions([
      { event: "preToolCall", command: "audit-hook" },
      { event: "postToolCall", command: "audit-hook" },
    ]);
    expect(parsed.hooks).toHaveLength(2);
    expect(parsed.warnings).toEqual([]);
  });

  it("treats absent config as empty and non-array shapes as one warning", () => {
    expect(parseHookDefinitions(undefined)).toEqual({ hooks: [], warnings: [] });
    expect(parseHookDefinitions(null)).toEqual({ hooks: [], warnings: [] });
    expect(parseHookDefinitions([])).toEqual({ hooks: [], warnings: [] });
    const bad = parseHookDefinitions("nope");
    expect(bad.hooks).toEqual([]);
    expect(bad.warnings).toHaveLength(1);
  });

  it("documents the timeout contract boundaries", () => {
    expect(DEFAULT_HOOK_TIMEOUT_MS).toBe(10000);
    expect(MAX_HOOK_TIMEOUT_MS).toBe(30000);
  });
});

describe("createHooksPlugin", () => {
  it("returns a factory-shaped plugin whose apply registers both faces", () => {
    const plugin = createHooksPlugin({
      getHooksConfig: async () => [],
      getWorkspaceRoot: () => "D:/ws/root",
    });
    expect(plugin.name).toBe("hooks");
    expect(typeof plugin.apply).toBe("function");
    const processors: MessageProcessor[] = [];
    const middlewares: ToolExecutionMiddleware[] = [];
    plugin.apply({
      session: { registerProcessor: (p: MessageProcessor) => processors.push(p) },
      tools: { registerMiddleware: (m: ToolExecutionMiddleware) => middlewares.push(m) },
    } as unknown as Context);
    expect(processors).toHaveLength(1);
    expect(middlewares).toHaveLength(1);
    expect(hooksDefault).toBe(createHooksPlugin);
  });
});
