import { describe, expect, it, vi } from "vitest";
import { createAppWindowLifecycle } from "./appWindowLifecycle";

type FakeWindow = { id: string };

describe("app window lifecycle wiring", () => {
  it("passes startup callback only to initial creation and recreates without it once", async () => {
    let current: FakeWindow | undefined;
    let releaseRecreate: (() => void) | undefined;
    const initial = { id: "initial" };
    const recreated = { id: "recreated" };
    const startup = vi.fn();
    const createMainWindow = vi.fn(async (onRendererReady?: () => void): Promise<FakeWindow> => {
      if (createMainWindow.mock.calls.length === 1) {
        current = initial;
        onRendererReady?.();
        return initial;
      }
      await new Promise<void>((resolve) => {
        releaseRecreate = resolve;
      });
      current = recreated;
      return recreated;
    });
    const lifecycle = createAppWindowLifecycle({
      createMainWindow,
      getMainWindow: () => current,
      onInitialRendererReady: startup,
    });

    await lifecycle.createInitialWindow();
    expect(createMainWindow.mock.calls[0]?.[0]).toBe(startup);
    expect(startup).toHaveBeenCalledOnce();

    current = undefined;
    const firstActivate = lifecycle.activate();
    const secondActivate = lifecycle.activate();
    expect(createMainWindow).toHaveBeenCalledTimes(2);
    expect(createMainWindow.mock.calls[1]).toEqual([]);

    releaseRecreate?.();
    await Promise.all([firstActivate, secondActivate]);
    expect(createMainWindow).toHaveBeenCalledTimes(2);
    expect(startup).toHaveBeenCalledOnce();
    expect(current).toBe(recreated);

    await lifecycle.activate();
    expect(createMainWindow).toHaveBeenCalledTimes(2);
  });
});
