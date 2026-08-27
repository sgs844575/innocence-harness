import { describe, expect, it, vi } from "vitest";
import { createMainAppLifecycle } from "./mainAppLifecycle";

type FakeWindow = { id: string };

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("main app lifecycle wiring", () => {
  it("starts recovery only for the initial window and de-duplicates activate recreation", async () => {
    let current: FakeWindow | undefined;
    let releaseRecreate: (() => void) | undefined;
    const recover = vi.fn(async () => {});
    const startAutomation = vi.fn();
    const createMainWindow = vi.fn(async (onRendererReady?: () => void): Promise<FakeWindow> => {
      if (createMainWindow.mock.calls.length === 1) {
        current = { id: "initial" };
        onRendererReady?.();
        return current;
      }
      await new Promise<void>((resolve) => {
        releaseRecreate = resolve;
      });
      current = { id: "recreated" };
      return current;
    });
    const lifecycle = createMainAppLifecycle({
      createMainWindow,
      getMainWindow: () => current,
      recover,
      startAutomation,
      logRecoveryFailure: vi.fn(),
      logAutomationStartFailure: vi.fn(),
    });

    await lifecycle.createInitialWindow();
    await lifecycle.startup.completion;
    expect(createMainWindow.mock.calls[0]?.[0]).toBe(lifecycle.startup.onRendererReady);
    expect(recover).toHaveBeenCalledOnce();
    expect(startAutomation).toHaveBeenCalledOnce();

    current = undefined;
    const firstActivate = lifecycle.activate();
    const secondActivate = lifecycle.activate();
    expect(createMainWindow).toHaveBeenCalledTimes(2);
    expect(createMainWindow.mock.calls[1]).toEqual([]);

    releaseRecreate?.();
    await Promise.all([firstActivate, secondActivate]);
    await flush();
    expect(createMainWindow).toHaveBeenCalledTimes(2);
    expect(recover).toHaveBeenCalledOnce();
    expect(startAutomation).toHaveBeenCalledOnce();
  });
});
