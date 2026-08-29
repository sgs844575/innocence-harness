import { describe, expect, it, vi } from "vitest";
import type { AutomationCandidate } from "@innocenceharness/harness-ai-runtime";
import { createAutomationService, type AutomationStore } from "../src";

const candidate: AutomationCandidate = {
  trigger: { kind: "schedule", expression: "0 9 * * 1", everyMs: 1_000 },
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
    remove: (id) => definitions.delete(id),
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
    await expect(service.confirmCandidate({
      ...candidate,
      trigger: { kind: "schedule", expression: "every second", everyMs: 0 },
    }, "Invalid schedule", "session-1")).rejects.toThrow("invalid automation candidate");
    const definition = await service.confirmCandidate(candidate, "Weekly tests", "session-1");
    expect(definition.targetSessionId).toBe("session-1");
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

    const updatedCandidate: AutomationCandidate = {
      ...candidate,
      trigger: { kind: "idle", expression: "after five minutes idle", idleForMs: 300_000 },
    };
    const updated = await service.updateDefinition("automation-1", updatedCandidate, "Idle tests", "session-1", false);
    expect(updated).toEqual(expect.objectContaining({
      id: "automation-1",
      name: "Idle tests",
      candidate: updatedCandidate,
      enabled: false,
      createdAt: 123,
      updatedAt: 123,
    }));
    expect(saved.list()).toEqual([updated]);
    expect(service.deleteDefinition("automation-1")).toBe(true);
    expect(service.deleteDefinition("automation-1")).toBe(false);
  });

  it("keeps legacy expression definitions listable and manually triggerable", async () => {
    const saved = store();
    const dispatch = vi.fn(async () => {});
    const legacy = {
      id: "legacy-1",
      name: "Legacy review",
      candidate: {
        trigger: { kind: "schedule" as const, expression: "0 9 * * 1" },
        actions: [{ kind: "review" as const, command: "Review pending tasks" }],
        constraints: ["ask permission"],
        reviewSummary: "Legacy manual review.",
      },
      enabled: true,
      createdAt: 1,
      updatedAt: 1,
    };
    saved.save(legacy as never);
    const service = createAutomationService({
      candidateService: { generate: vi.fn(async () => ({ candidate, metadata: { providerId: "p", modelId: "m" } })) },
      candidateModel: model,
      store: saved,
      dispatch: { dispatch },
    });

    expect(service.list()).toEqual([legacy]);
    await service.trigger("legacy-1", { trigger: "manual", sessionId: "session-1", routeId: "main" });
    expect(dispatch).toHaveBeenCalledOnce();
  });

  it("forwards an external abort signal into controlled dispatch cleanup", async () => {
    vi.useFakeTimers();
    try {
      const saved = store();
      let receivedSignal: AbortSignal | undefined;
      const dispatch = vi.fn(({ signal }: { signal: AbortSignal }) => {
        receivedSignal = signal;
        return new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
      });
      const service = createAutomationService({
        candidateService: { generate: vi.fn(async () => ({ candidate, metadata: { providerId: "p", modelId: "m" } })) },
        candidateModel: model,
        store: saved,
        dispatch: { dispatch },
        timeoutMs: 60_000,
        id: () => "automation-external-abort",
      });

      await service.confirmCandidate(candidate, "External abort", "session-1");
      const controller = new AbortController();
      const pending = service.trigger("automation-external-abort", {
        trigger: "schedule",
        sessionId: "session-1",
        routeId: "main",
        signal: controller.signal,
      });
      controller.abort();
      expect(receivedSignal?.aborted).toBe(true);
      await pending;
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects a second trigger while the definition is already running", async () => {
    const saved = store();
    let finish: (() => void) | undefined;
    let calls = 0;
    const dispatch = vi.fn(() => {
      calls += 1;
      if (calls > 1) return Promise.resolve();
      return new Promise<void>((resolve) => { finish = resolve; });
    });
    const service = createAutomationService({
      candidateService: { generate: vi.fn(async () => ({ candidate, metadata: { providerId: "p", modelId: "m" } })) },
      candidateModel: model,
      store: saved,
      dispatch: { dispatch },
      id: () => "automation-no-overlap",
    });
    await service.confirmCandidate(candidate, "No overlap", "session-1");

    const first = service.trigger("automation-no-overlap", { trigger: "manual", sessionId: "session-1", routeId: "main" });
    await expect(service.trigger("automation-no-overlap", { trigger: "schedule", sessionId: "session-1", routeId: "main" })).rejects.toThrow("automation already running");
    expect(dispatch).toHaveBeenCalledOnce();
    finish?.();
    await first;
  });

  it("does not dispatch when an external signal is already aborted", async () => {
    const saved = store();
    const dispatch = vi.fn(async () => {});
    const service = createAutomationService({
      candidateService: { generate: vi.fn(async () => ({ candidate, metadata: { providerId: "p", modelId: "m" } })) },
      candidateModel: model,
      store: saved,
      dispatch: { dispatch },
      id: () => "automation-pre-aborted",
    });
    await service.confirmCandidate(candidate, "Pre-aborted", "session-1");
    const controller = new AbortController();
    controller.abort();

    await service.trigger("automation-pre-aborted", {
      trigger: "schedule",
      sessionId: "session-1",
      routeId: "main",
      signal: controller.signal,
    });
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("rejects malformed trigger identity input before dispatch", async () => {
    const saved = store();
    const dispatch = vi.fn(async () => {});
    const service = createAutomationService({
      candidateService: { generate: vi.fn(async () => ({ candidate, metadata: { providerId: "p", modelId: "m" } })) },
      candidateModel: model,
      store: saved,
      dispatch: { dispatch },
      id: () => "automation_input",
    });
    await service.confirmCandidate(candidate, "Input validation", "session-1");

    await expect(service.confirmCandidate(candidate, 42 as never, "session-1")).rejects.toThrow("automation name is required");
    await expect(service.confirmCandidate(candidate, "Target validation", 42 as never)).rejects.toThrow("automation target session is required");
    await expect(service.updateDefinition("automation_input", candidate, "Update", "session-1", "true" as never)).rejects.toThrow("automation enabled flag is required");
    await expect(service.trigger(42 as never, { trigger: "manual", sessionId: "session-1", routeId: "main" })).rejects.toThrow("automation id is required");
    await expect(service.trigger("automation_input", { trigger: "manual", sessionId: 42 as never, routeId: "main" })).rejects.toThrow("automation session is required");
    await expect(service.trigger("automation_input", { trigger: "unexpected" as never, sessionId: "session-1", routeId: "main" })).rejects.toThrow("invalid automation trigger");
    expect(dispatch).not.toHaveBeenCalled();
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

    await expect(service.confirmCandidate({ ...candidate, actions: [] }, "bad", "session-1")).rejects.toThrow("invalid automation candidate");
    await service.confirmCandidate(candidate, "Timeout", "session-1");
    await expect(service.trigger("automation-timeout", { trigger: "manual", sessionId: "session-1", routeId: "main" })).resolves.toBeUndefined();
    expect(dispatch.mock.calls[0]?.[0].signal.aborted).toBe(true);
  });

  it("propagates dispatch outcomes for dynamic pacing consumers and keeps loop definitions listable", async () => {
    const saved = store();
    const dispatch = vi.fn(async (): Promise<{ productive: boolean } | void> => ({ productive: false }));
    const service = createAutomationService({
      candidateService: { generate: vi.fn(async () => ({ candidate, metadata: { providerId: "p", modelId: "m" } })) },
      candidateModel: model,
      store: saved,
      dispatch: { dispatch },
      id: () => "automation-outcome",
    });

    const definition = await service.confirmCandidate(candidate, "Outcome", "session-1");
    saved.save({ ...definition, loop: { loopFile: "loops/main.md", pacing: { minMs: 60_000, maxMs: 1_800_000 } } });
    expect(service.list()[0]?.loop).toEqual({ loopFile: "loops/main.md", pacing: { minMs: 60_000, maxMs: 1_800_000 } });

    await expect(service.trigger("automation-outcome", { trigger: "schedule", sessionId: "session-1", routeId: "main" })).resolves.toEqual({ productive: false });
    dispatch.mockResolvedValue(undefined);
    await expect(service.trigger("automation-outcome", { trigger: "schedule", sessionId: "session-1", routeId: "main" })).resolves.toBeUndefined();
  });

  it("preserves the loop payload across definition updates", async () => {
    const saved = store();
    const dispatch = vi.fn(async () => {});
    const service = createAutomationService({
      candidateService: { generate: vi.fn(async () => ({ candidate, metadata: { providerId: "p", modelId: "m" } })) },
      candidateModel: model,
      store: saved,
      dispatch: { dispatch },
      id: () => "automation-loop-keep",
    });

    const definition = await service.confirmCandidate(candidate, "Loop keep", "session-1");
    const loop = { loopFile: "loops/main.md", pacing: { minMs: 60_000, maxMs: 1_800_000 } };
    saved.save({ ...definition, loop });

    const updated = await service.updateDefinition("automation-loop-keep", candidate, "Loop keep disabled", "session-1", false);
    expect(updated.enabled).toBe(false);
    expect(updated.loop).toEqual(loop);
    expect(service.list()[0]?.loop).toEqual(loop);
  });
});
