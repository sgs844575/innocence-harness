import { describe, expect, it, vi } from "vitest";
import { createRendererReadyStartup } from "./rendererReadyStartup";

async function flushStartup(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("renderer-ready startup", () => {
  it("recovers after renderer ready and starts automation after recovery succeeds", async () => {
    const events: string[] = [];
    const startup = createRendererReadyStartup({
      recover: vi.fn(async () => {
        events.push("recover");
      }),
      startAutomation: vi.fn(() => {
        events.push("start automation");
      }),
      logRecoveryFailure: vi.fn(),
    });

    startup();
    await flushStartup();

    expect(events).toEqual(["recover", "start automation"]);
  });

  it("logs recovery failure and still starts automation, only once", async () => {
    const error = new Error("recovery failed");
    const recover = vi.fn(async () => {
      throw error;
    });
    const startAutomation = vi.fn();
    const logRecoveryFailure = vi.fn();
    const startup = createRendererReadyStartup({ recover, startAutomation, logRecoveryFailure });

    startup();
    startup();
    await flushStartup();

    expect(recover).toHaveBeenCalledOnce();
    expect(logRecoveryFailure).toHaveBeenCalledWith(error);
    expect(startAutomation).toHaveBeenCalledOnce();
  });
});
