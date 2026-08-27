import { describe, expect, it, vi } from "vitest";
import { createOwnedShutdown } from "./ownedShutdown";
import { createRendererReadyStartup } from "./rendererReadyStartup";
import { ShutdownGate } from "./shutdown";

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function shutdownDeps(overrides: Partial<Parameters<typeof createOwnedShutdown>[0]> = {}) {
  return {
    blockStartup: vi.fn(),
    waitForStartup: vi.fn(async () => {}),
    rejectPendingPermissionAsks: vi.fn(),
    disposeAutomationLifecycle: vi.fn(async () => {}),
    disposeAllRuntime: vi.fn(async () => {}),
    disposeTelemetry: vi.fn(async () => {}),
    disposePluginBoot: vi.fn(async () => {}),
    disposeTaskRuntime: vi.fn(async () => {}),
    disposeTerminals: vi.fn(async () => {}),
    ...overrides,
  };
}

describe("owned shutdown", () => {
  it("waits for deferred startup before disposing automation and task resources", async () => {
    const events: string[] = [];
    const resources = { timers: 0, listeners: 0, runtimes: 0 };
    let releaseRecovery: (() => void) | undefined;
    const createAutomationResources = vi.fn(() => {
      events.push("start-automation");
      resources.timers += 1;
      resources.listeners += 1;
      resources.runtimes += 1;
    });
    const startup = createRendererReadyStartup({
      recover: vi.fn(() => new Promise<void>((resolve) => {
        events.push("recover-start");
        releaseRecovery = () => {
          events.push("recover-complete");
          resolve();
        };
      })),
      startAutomation: createAutomationResources,
      logRecoveryFailure: vi.fn(),
      logAutomationStartFailure: vi.fn(),
    });
    const shutdown = createOwnedShutdown(shutdownDeps({
      blockStartup: vi.fn(() => {
        events.push("block-startup");
        startup.block();
      }),
      waitForStartup: () => startup.completion,
      rejectPendingPermissionAsks: vi.fn(() => events.push("reject-permissions")),
      disposeAutomationLifecycle: vi.fn(async () => {
        events.push("dispose-automation");
        resources.timers = 0;
        resources.listeners = 0;
        resources.runtimes = 0;
      }),
      disposeAllRuntime: vi.fn(async () => { events.push("dispose-runtime"); }),
      disposeTaskRuntime: vi.fn(async () => { events.push("dispose-task-runtime"); }),
    }));

    startup.onRendererReady();
    await flush();
    const release = shutdown();
    await flush();
    expect(events).toEqual(["recover-start", "block-startup", "reject-permissions"]);

    releaseRecovery?.();
    await release;
    expect(events).toEqual([
      "recover-start",
      "block-startup",
      "reject-permissions",
      "recover-complete",
      "start-automation",
      "dispose-automation",
      "dispose-runtime",
      "dispose-task-runtime",
    ]);

    startup.onRendererReady();
    await flush();
    expect(createAutomationResources).toHaveBeenCalledOnce();
    expect(resources).toEqual({ timers: 0, listeners: 0, runtimes: 0 });
  });

  it("holds re-entrant before-quit while deferred startup is still owned", async () => {
    let releaseRecovery: (() => void) | undefined;
    const startup = createRendererReadyStartup({
      recover: vi.fn(() => new Promise<void>((resolve) => {
        releaseRecovery = resolve;
      })),
      startAutomation: vi.fn(),
      logRecoveryFailure: vi.fn(),
      logAutomationStartFailure: vi.fn(),
    });
    const shutdownWork = createOwnedShutdown(shutdownDeps({
      blockStartup: () => startup.block(),
      waitForStartup: () => startup.completion,
    }));
    const gate = new ShutdownGate();
    startup.onRendererReady();
    await flush();

    const firstPhase = gate.onBeforeQuit();
    const release = shutdownWork();
    const secondPhase = gate.onBeforeQuit();
    expect(firstPhase).toBe("start");
    expect(secondPhase).toBe("hold");

    releaseRecovery?.();
    await release;
    gate.markReleased();
    expect(gate.onBeforeQuit()).toBe("release");
  });

  it("blocks renderer startup when shutdown disposes before renderer ready", async () => {
    const recover = vi.fn(async () => {});
    const createAutomationResources = vi.fn();
    const startup = createRendererReadyStartup({
      recover,
      startAutomation: createAutomationResources,
      logRecoveryFailure: vi.fn(),
      logAutomationStartFailure: vi.fn(),
    });
    const disposeAutomationLifecycle = vi.fn(async () => {});
    const shutdown = createOwnedShutdown(shutdownDeps({
      blockStartup: () => startup.block(),
      waitForStartup: () => startup.completion,
      disposeAutomationLifecycle,
    }));

    await shutdown();
    startup.onRendererReady();
    await flush();

    expect(recover).not.toHaveBeenCalled();
    expect(createAutomationResources).not.toHaveBeenCalled();
    expect(disposeAutomationLifecycle).toHaveBeenCalledOnce();
  });
});
