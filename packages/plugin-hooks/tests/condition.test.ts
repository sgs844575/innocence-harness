import { describe, expect, it } from "vitest";
import type { Provider } from "@innocenceharness/harness-providers";
import { createHookConditionEvaluator, HOOK_EVALUATOR_HISTORY_LIMIT } from "../src/condition";
import { parseHookDefinitions } from "../src/config";

function providerWith(text: string, capture?: (system: string, messages: unknown[]) => void): Provider {
  return {
    id: "condition-test",
    async *chat(req) {
      capture?.(req.system, req.messages);
      yield { type: "text", text };
    },
  };
}

describe("hook condition evaluator", () => {
  it("passes only the recent history tail and states the omitted count", async () => {
    const history = Array.from({ length: HOOK_EVALUATOR_HISTORY_LIMIT + 3 }, (_, i) => ({
      role: "user" as const,
      parts: [{ type: "text" as const, text: `m${i}` }],
    }));
    let system = "";
    let messages: unknown[] = [];
    const evaluator = createHookConditionEvaluator(
      providerWith('{"ok":true,"reason":"matches"}', (s, m) => {
        system = s;
        messages = m;
      }),
      () => history,
    );
    await expect(evaluator.evaluate({ condition: "only when relevant", hook: { toolName: "Write" } })).resolves.toEqual({
      ok: true,
      reason: "matches",
    });
    expect(system).toContain("3 message(s) omitted");
    const payload = JSON.stringify(messages);
    expect(payload).toContain(`m${history.length - HOOK_EVALUATOR_HISTORY_LIMIT}`);
    expect(payload).not.toContain("m0");
  });

  it("fails closed on malformed JSON or provider failure", async () => {
    const malformed = createHookConditionEvaluator(providerWith("not json"), () => []);
    await expect(malformed.evaluate({ condition: "x", hook: {} })).resolves.toMatchObject({ ok: false });
    const failed: Provider = { id: "bad", async *chat() { throw new Error("down"); } };
    const unavailable = createHookConditionEvaluator(failed, () => []);
    await expect(unavailable.evaluate({ condition: "x", hook: {} })).resolves.toMatchObject({ ok: false });
  });
});

describe("hook condition configuration", () => {
  it("parses a non-empty condition and rejects invalid values", () => {
    const parsed = parseHookDefinitions([{ event: "preToolCall", command: "node hook.js", condition: "only safe writes" }]);
    expect(parsed.hooks[0]).toMatchObject({ condition: "only safe writes" });
    expect(parseHookDefinitions([{ event: "preToolCall", command: "node hook.js", condition: "" }]).hooks).toEqual([]);
    expect(parseHookDefinitions([{ event: "preToolCall", command: "node hook.js", condition: 1 }]).warnings[0]).toContain("condition");
  });
});
