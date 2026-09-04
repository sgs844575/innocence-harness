// plugin-hooks permission gate tests (final review round, finding 1):
// every hook command runs only after a first-encounter permission
// resolution — a fake permissions service records the resolve calls so the
// tests assert the synthetic resource shape, the once-per-command-string
// contract, the deny-skip-warning path on every face, and the fail-closed
// skip when the authorization surface itself is absent.
import type { PermissionsService, PermissionRequest } from "@innocenceharness/harness-permissions";
import { describe, expect, it } from "vitest";
import type { HookDefinition } from "../src/config";
import type { HookRunInput, HookRunner } from "../src/runner";
import { createHooksWiring } from "../src";

/** What the fake engine saw: the request plus the tool metadata. */
interface RecordedResolve {
  request: PermissionRequest;
  toolMeta: { readOnly: boolean; sideEffect?: string };
}

/**
 * Fake permissions service: the engine surface collapses to resolve(), the
 * only member the gate consumes. decide() answers every resolution.
 */
function fakePermissions(decide: () => "allow" | "deny" = () => "allow"): {
  service: PermissionsService;
  calls: RecordedResolve[];
} {
  const calls: RecordedResolve[] = [];
  const service = {
    engine: {
      async resolve(request: PermissionRequest, toolMeta: { readOnly: boolean; sideEffect?: string }) {
        calls.push({ request, toolMeta });
        return { decision: decide(), via: "ask", reason: "gate fixture" };
      },
    },
  } as unknown as PermissionsService;
  return { service, calls };
}

/** Runner stub that never spawns: the gate must stop calls before it. */
function countingRunner(counter: { runs: number; inputs: HookRunInput[] }): HookRunner {
  return {
    async runHook(_hook: HookDefinition, input: HookRunInput) {
      counter.runs += 1;
      counter.inputs.push(input);
      return { ok: true, output: "gate fixture output" };
    },
  };
}

const ROOT = "D:/ws/root";

function userMessage(text: string) {
  return { role: "user" as const, parts: [{ type: "text" as const, text }] };
}

function processorContext(sessionId: string) {
  return {
    signal: new AbortController().signal,
    provider: {} as never,
    scope: { sessionId },
  };
}

function textOf(message: { parts: { type: string; text?: string }[] }): string {
  return message.parts.map((part) => (part.type === "text" ? part.text ?? "" : "")).join("\n");
}

describe("hook permission gate", () => {
  it("resolves each distinct command string once, then runs without re-asking", async () => {
    const { service, calls } = fakePermissions();
    const counter = { runs: 0, inputs: [] as HookRunInput[] };
    const wiring = createHooksWiring({
      getHooksConfig: async () => [{ event: "userPromptSubmit", command: "inject-tool --mode deep" }],
      getWorkspaceRoot: () => ROOT,
      getPermissions: () => service,
      runner: countingRunner(counter),
    });
    await wiring.processor.process(userMessage("first"), processorContext("sess-1"));
    await wiring.processor.process(userMessage("second"), processorContext("sess-1"));
    await wiring.processor.process(userMessage("third"), processorContext("sess-1"));
    expect(calls).toHaveLength(1);
    expect(counter.runs).toBe(2);
    expect(calls[0].request.toolName).toBe("hooks");
    expect(calls[0].request.resource).toEqual({
      action: "run",
      kind: "hook",
      scope: "inject-tool",
    });
    expect(typeof calls[0].request.args.command).toBe("string");
    expect(calls[0].toolMeta).toEqual({ readOnly: false, sideEffect: "process" });
  });

  it("resolves distinct command strings separately under one executable scope", async () => {
    const { service, calls } = fakePermissions();
    const counter = { runs: 0, inputs: [] as HookRunInput[] };
    const wiring = createHooksWiring({
      getHooksConfig: async () => [
        { event: "userPromptSubmit", command: "same-exe --one" },
        { event: "userPromptSubmit", command: "same-exe --two" },
      ],
      getWorkspaceRoot: () => ROOT,
      getPermissions: () => service,
      runner: countingRunner(counter),
    });
    await wiring.processor.process(userMessage("first"), processorContext("sess-1"));
    await wiring.processor.process(userMessage("turn"), processorContext("sess-1"));
    expect(calls).toHaveLength(2);
    expect(calls[0].request.resource.scope).toBe("same-exe");
    expect(calls[1].request.resource.scope).toBe("same-exe");
    expect(counter.runs).toBe(2);
  });

  it("skips the hook and warns on the prompt face when the gate denies", async () => {
    const { service } = fakePermissions(() => "deny");
    const counter = { runs: 0, inputs: [] as HookRunInput[] };
    const wiring = createHooksWiring({
      getHooksConfig: async () => [{ event: "userPromptSubmit", command: "denied-inject" }],
      getWorkspaceRoot: () => ROOT,
      getPermissions: () => service,
      runner: countingRunner(counter),
    });
    await wiring.processor.process(userMessage("first"), processorContext("sess-1"));
    const second = await wiring.processor.process(userMessage("turn"), processorContext("sess-1"));
    const text = textOf(second);
    expect(counter.runs).toBe(0);
    expect(text).toContain("[hook warning]");
    expect(text).toContain("denied-inject");
    expect(text).toContain("permission");
  });

  it("re-asks after a denial instead of caching the refusal", async () => {
    let decisions = 0;
    const { service, calls } = fakePermissions(() => {
      decisions += 1;
      return decisions <= 1 ? "deny" : "allow";
    });
    const counter = { runs: 0, inputs: [] as HookRunInput[] };
    const wiring = createHooksWiring({
      getHooksConfig: async () => [{ event: "userPromptSubmit", command: "retry-inject" }],
      getWorkspaceRoot: () => ROOT,
      getPermissions: () => service,
      runner: countingRunner(counter),
    });
    await wiring.processor.process(userMessage("first"), processorContext("sess-1"));
    await wiring.processor.process(userMessage("turn two"), processorContext("sess-1"));
    await wiring.processor.process(userMessage("turn three"), processorContext("sess-1"));
    expect(calls).toHaveLength(2);
    expect(counter.runs).toBe(1);
  });

  it("gates session-start hooks the same way", async () => {
    const { service } = fakePermissions(() => "deny");
    const counter = { runs: 0, inputs: [] as HookRunInput[] };
    const wiring = createHooksWiring({
      getHooksConfig: async () => [{ event: "sessionStart", command: "denied-boot" }],
      getWorkspaceRoot: () => ROOT,
      getPermissions: () => service,
      runner: countingRunner(counter),
    });
    const message = await wiring.processor.process(userMessage("hi"), processorContext("sess-1"));
    const text = textOf(message);
    expect(counter.runs).toBe(0);
    expect(text).toContain("[hook warning]");
    expect(text).toContain("denied-boot");
  });

  it("a pre-face denial lets the tool run and only warns on the next turn", async () => {
    const { service } = fakePermissions(() => "deny");
    const counter = { runs: 0, inputs: [] as HookRunInput[] };
    const wiring = createHooksWiring({
      getHooksConfig: async () => [{ event: "preToolCall", command: "denied-guard", match: "Write" }],
      getWorkspaceRoot: () => ROOT,
      getPermissions: () => service,
      runner: countingRunner(counter),
    });
    let nextCalls = 0;
    const result = await wiring.middleware.execute(
      {
        invocationId: "inv-1",
        toolName: "Write",
        args: {},
        signal: new AbortController().signal,
        scope: { invocationId: "inv-1", toolName: "Write" },
      },
      async () => {
        nextCalls += 1;
        return { content: "wrote anyway" };
      },
    );
    expect(result).toEqual({ content: "wrote anyway" });
    expect(nextCalls).toBe(1);
    expect(counter.runs).toBe(0);
    await wiring.processor.process(userMessage("first"), processorContext("sess-1"));
    const next = await wiring.processor.process(userMessage("more"), processorContext("sess-1"));
    expect(textOf(next)).toContain("denied-guard");
  });

  it("fails closed when the permission service is absent", async () => {
    const counter = { runs: 0, inputs: [] as HookRunInput[] };
    const wiring = createHooksWiring({
      getHooksConfig: async () => [{ event: "userPromptSubmit", command: "orphan-inject" }],
      getWorkspaceRoot: () => ROOT,
      getPermissions: () => undefined,
      runner: countingRunner(counter),
    });
    await wiring.processor.process(userMessage("first"), processorContext("sess-1"));
    const second = await wiring.processor.process(userMessage("turn"), processorContext("sess-1"));
    const text = textOf(second);
    expect(counter.runs).toBe(0);
    expect(text).toContain("[hook warning]");
    expect(text).toContain("orphan-inject");
    expect(text).toContain("permission service");
  });
});
