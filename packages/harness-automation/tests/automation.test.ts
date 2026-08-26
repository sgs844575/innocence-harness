import { describe, expect, it, vi } from "vitest";
import type { AutomationCandidate } from "@innocenceharness/harness-ai-runtime";
import { createAutomationService, type AutomationStore } from "../src";

const candidate: AutomationCandidate = {
  trigger: { kind: "schedule", expression: "0 9 * * 1" },
  actions: [{ kind: "run-command", command: "npm test" }],
  constraints: ["read-only"],
  reviewSummary: "Review before enabling.",
};

const model = { value: {}, providerId: "p", modelId: "m" };

function store(): AutomationStore {
  const definitions = new Map<string, any>();
  return {
    list: () => [...definitions.values()],
    save: (definition) => { definitions.set(definition.id, definition); },
  };
}

describe("controlled automation service", () => {
  it("generates a validated candidate through the injected structured output port", async () => {
    const generate = vi.fn(async () => ({ candidate, metadata: { providerId: "p", modelId: "m" } }));
    const service = createAutomationService({
      candidateService: { generate },
      candidateModel: model,
      store: store(),
      dispatch: { dispatch: vi.fn(async () => {}) },
    });

    await expect(service.generateCandidate("run tests every Monday")).resolves.toEqual(candidate);
    expect(generate).toHaveBeenCalledOnce();
  });

  it("persists only after confirmation and dispatches manual, schedule, and idle triggers with identity and timeout", async () => {
    const saved = store();
    const dispatch = vi.fn(async () => {});
    const service = createAutomationService({
      candidateService: { generate: vi.fn(async () => ({ candidate, metadata: { providerId: "p", modelId: "m" } })) },
      candidateModel: model,
      store: saved,
      dispatch: { dispatch },
      timeoutMs: 5000,
      id: () => "automation-1",
      now: () => 123,
    });

    expect(saved.list()).toEqual([]);
    const definition = await service.confirmCandidate(candidate, "Weekly tests");
    expect(saved.list()).toEqual([definition]);

    await expect(service.trigger("automation-1", { trigger: "manual", sessionId: "", routeId: "main" })).rejects.toThrow("automation session is required");
    await service.trigger("automation-1", { trigger: "manual", sessionId: "session-1", taskId: "task-1", routeId: "main" });
    await service.trigger("automation-1", { trigger: "schedule", sessionId: "session-1", routeId: "main" });
    await service.trigger("automation-1", { trigger: "idle", sessionId: "session-1", routeId: "main" });
    expect(dispatch).toHaveBeenCalledTimes(3);
    expect(dispatch).toHaveBeenLastCalledWith(expect.objectContaining({
      automationId: "automation-1",
      sessionId: "session-1",
      routeId: "main",
      timeoutMs: 5000,
    }));
  });

  it("rejects invalid candidates and always aborts timed-out dispatches", async () => {
    const saved = store();
    const dispatch = vi.fn(({ signal }: { signal: AbortSignal }) => new Promise<void>((resolve) => {
      signal.addEventListener("abort", () => resolve(), { once: true });
    }));
    const service = createAutomationService({
      candidateService: { generate: vi.fn(async () => ({ candidate, metadata: { providerId: "p", modelId: "m" } })) },
      candidateModel: model,
      store: saved,
      dispatch: { dispatch },
      timeoutMs: 5,
      id: () => "automation-timeout",
    });

    await expect(service.confirmCandidate({ ...candidate, actions: [] }, "bad")).rejects.toThrow("invalid automation candidate");
    await service.confirmCandidate(candidate, "Timeout");
    await expect(service.trigger("automation-timeout", { trigger: "manual", sessionId: "session-1", routeId: "main" })).resolves.toBeUndefined();
    expect(dispatch.mock.calls[0]?.[0].signal.aborted).toBe(true);
  });
});
