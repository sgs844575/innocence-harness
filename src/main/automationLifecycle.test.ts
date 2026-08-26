import { describe, expect, it, vi } from "vitest";
import type { AutomationCandidate, AutomationDefinition, AutomationService } from "@innocenceharness/harness-automation";
import { createAutomationLifecycle } from "./automationLifecycle";

const candidate: AutomationCandidate = {
  trigger: { kind: "schedule", expression: "every second", everyMs: 1_000 },
  actions: [{ kind: "review", command: "Review pending tasks" }],
  constraints: ["ask permission"],
  reviewSummary: "Review pending tasks on schedule.",
};

const definition = (overrides: Partial<AutomationDefinition> = {}): AutomationDefinition => ({
  id: "automation-1",
  name: "Scheduled review",
  candidate,
  targetSessionId: "session-1",
  enabled: true,
  createdAt: 1,
  updatedAt: 1,
  ...overrides,
});

function service(definitions: AutomationDefinition[]): AutomationService {
  return {
    generateCandidate: vi.fn(),
    confirmCandidate: vi.fn(async (_candidate, name, targetSessionId) => {
      const next = definition({ name, targetSessionId, updatedAt: 2 });
      definitions.push(next);
      return next;
    }),
    updateDefinition: vi.fn(async (id, _candidate, name, targetSessionId, enabled) => {
      const index = definitions.findIndex((item) => item.id === id);
      if (index < 0) throw new Error("automation not found");
      const next = definition({ id, name, targetSessionId, enabled, updatedAt: 3 });
      definitions[index] = next;
      return next;
    }),
    deleteDefinition: vi.fn((id) => {
      const index = definitions.findIndex((item) => item.id === id);
      if (index < 0) return false;
      definitions.splice(index, 1);
      return true;
    }),
    list: vi.fn(() => [...definitions]),
    trigger: vi.fn(async () => {}),
  } as AutomationService;
}

describe("automation lifecycle", () => {
  it("restores confirmed durable definitions at startup and dispatches due schedules", async () => {
    vi.useFakeTimers();
    try {
      const definitions = [definition()];
      const controlledService = service(definitions);
      const lifecycle = createAutomationLifecycle({ controlledService, isIdle: () => false });

      lifecycle.start();
      await vi.advanceTimersByTimeAsync(1_000);
      expect(controlledService.trigger).toHaveBeenCalledWith("automation-1", expect.objectContaining({
        trigger: "schedule",
        sessionId: "session-1",
        signal: expect.any(AbortSignal),
      }));
      await lifecycle.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("resynchronizes the dispatcher after confirmation and update", async () => {
    const definitions: AutomationDefinition[] = [];
    const controlledService = service(definitions);
    const lifecycle = createAutomationLifecycle({ controlledService, isIdle: () => false });

    await lifecycle.confirm(candidate, "First", "session-1");
    await lifecycle.update("automation-1", candidate, "Updated", "session-1", false);

    expect(controlledService.list).toHaveBeenCalledTimes(2);
    expect(controlledService.updateDefinition).toHaveBeenCalledWith("automation-1", candidate, "Updated", "session-1", false);
    await lifecycle.dispose();
  });

  it("removes a definition from durable state and aborts its active automatic dispatch", async () => {
    vi.useFakeTimers();
    try {
      const definitions = [definition()];
      let activeSignal: AbortSignal | undefined;
      const controlledService = service(definitions);
      controlledService.trigger = vi.fn((_id, input) => new Promise<void>((resolve) => {
        activeSignal = input.signal;
        input.signal.addEventListener("abort", () => resolve(), { once: true });
      }));
      const lifecycle = createAutomationLifecycle({ controlledService, isIdle: () => false });

      lifecycle.start();
      await vi.advanceTimersByTimeAsync(1_000);
      expect(activeSignal?.aborted).toBe(false);
      expect(lifecycle.delete("automation-1")).toBe(true);
      expect(activeSignal?.aborted).toBe(true);
      await lifecycle.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("awaits dispatcher disposal through its owner", async () => {
    const controlledService = service([]);
    const dispose = vi.fn(async () => {});
    const lifecycle = createAutomationLifecycle({
      controlledService,
      isIdle: () => false,
      dispatcher: { start: vi.fn(), sync: vi.fn(), remove: vi.fn(), dispose },
    });

    await lifecycle.dispose();
    expect(dispose).toHaveBeenCalledOnce();
  });
});
