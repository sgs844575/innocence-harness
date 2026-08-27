import { describe, expect, it, vi } from "vitest";
import { createRendererReadyStartup } from "./rendererReadyStartup";

async function flushStartup(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("renderer-ready startup", () => {
  it("exposes one completion promise and starts automation after deferred recovery", async () => {
    const events: string[] = [];
    let releaseRecovery: (() => void) | undefined;
    const startup = createRendererReadyStartup({
      recover: vi.fn(() => new Promise<void>((resolve) => {
        events.push("recover-start");
        releaseRecovery = resolve;
      })),
      startAutomation: vi.fn(() => {
        events.push("start automation");
      }),
      logRecoveryFailure: vi.fn(),
      logAutomationStartFailure: vi.fn(),
    });

    expect(startup.completion).toBe(startup.completion);
    startup.onRendererReady();
    await flushStartup();

    expect(events).toEqual(["recover-start"]);
    let disposed = false;
    const dispose = startup.completion.then(() => {
      disposed = true;
      events.push("dispose");
    });
    await flushStartup();
    expect(disposed).toBe(false);

    releaseRecovery?.();
    await dispose;
    expect(events).toEqual(["recover-start", "start automation", "dispose"]);
  });

  it("logs recovery failure, starts automation in finally, and only starts once", async () => {
    const error = new Error("recovery failed");
    const recover = vi.fn(async () => {
      throw error;
    });
    const startAutomation = vi.fn();
    const logRecoveryFailure = vi.fn();
    const startup = createRendererReadyStartup({
      recover,
      startAutomation,
      logRecoveryFailure,
      logAutomationStartFailure: vi.fn(),
    });

    startup.onRendererReady();
    startup.onRendererReady();
    await startup.completion;

    expect(recover).toHaveBeenCalledOnce();
    expect(logRecoveryFailure).toHaveBeenCalledWith(error);
    expect(startAutomation).toHaveBeenCalledOnce();
  });

  it("records automation startup failure and still settles its completion", async () => {
    const error = new Error("automation startup failed");
    const logAutomationStartFailure = vi.fn();
    const startup = createRendererReadyStartup({
      recover: vi.fn(async () => {}),
      startAutomation: vi.fn(() => {
        throw error;
      }),
      logRecoveryFailure: vi.fn(),
      logAutomationStartFailure,
    });

    startup.onRendererReady();
    await startup.completion;

    expect(logAutomationStartFailure).toHaveBeenCalledWith(error);
  });

  it("blocks a not-yet-started renderer recovery after shutdown begins", async () => {
    const recover = vi.fn(async () => {});
    const startAutomation = vi.fn();
    const startup = createRendererReadyStartup({
      recover,
      startAutomation,
      logRecoveryFailure: vi.fn(),
      logAutomationStartFailure: vi.fn(),
    });

    startup.block();
    startup.onRendererReady();
    await startup.completion;

    expect(recover).not.toHaveBeenCalled();
    expect(startAutomation).not.toHaveBeenCalled();
  });
});
