// keepAwake 电源阻止器：幂等 start/stop 与释放路径。
import { afterEach, describe, expect, it, vi } from "vitest";

const { blocker } = vi.hoisted(() => ({
  blocker: { nextId: 1, started: [] as number[], stopped: [] as number[] },
}));

vi.mock("electron", () => ({
  powerSaveBlocker: {
    start: vi.fn((_type: string) => {
      const id = blocker.nextId++;
      blocker.started.push(id);
      return id;
    }),
    stop: vi.fn((id: number) => {
      blocker.stopped.push(id);
    }),
  },
}));

import { applyKeepAwake, disposeKeepAwake, isKeepAwakeActive } from "./powerBlocker";

afterEach(() => {
  disposeKeepAwake();
  blocker.started.length = 0;
  blocker.stopped.length = 0;
  blocker.nextId = 1;
  vi.clearAllMocks();
});

describe("applyKeepAwake", () => {
  it("开启启动一次 blocker（幂等），关闭停止", () => {
    applyKeepAwake(true);
    applyKeepAwake(true);
    expect(blocker.started).toEqual([1]);
    expect(isKeepAwakeActive()).toBe(true);

    applyKeepAwake(false);
    expect(blocker.stopped).toEqual([1]);
    expect(isKeepAwakeActive()).toBe(false);
  });

  it("关闭未开启的 blocker 是空操作；dispose 释放存活 blocker", () => {
    applyKeepAwake(false);
    expect(blocker.stopped).toEqual([]);

    applyKeepAwake(true);
    disposeKeepAwake();
    expect(blocker.stopped).toEqual([1]);
    expect(isKeepAwakeActive()).toBe(false);
  });

  it("使用 prevent-display-sleep 类型", async () => {
    const { powerSaveBlocker } = await import("electron");
    applyKeepAwake(true);
    expect(powerSaveBlocker.start).toHaveBeenCalledWith("prevent-display-sleep");
  });
});
