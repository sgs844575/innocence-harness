import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => Promise<unknown>>(),
  windows: [] as { isDestroyed: () => boolean; webContents: { send: ReturnType<typeof vi.fn> } }[],
}));
vi.mock("electron", () => ({
  app: { once: vi.fn() },
  BrowserWindow: { getAllWindows: () => mocks.windows },
  ipcMain: { handle: (channel: string, handler: (...args: unknown[]) => unknown) => mocks.handlers.set(channel, async (...args) => handler(...args)) },
}));
let dataRoot: string;
vi.mock("./appDataRoot", () => ({ appDataRoot: () => dataRoot }));
import { createWorkbenchWatchRegistry, registerWorkbenchIpc } from "./workbenchIpc";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((r) => fs.rm(r, { recursive: true, force: true }))); });

describe("registerWorkbenchIpc", () => {
  beforeEach(async () => {
    mocks.handlers.clear();
    mocks.windows.length = 0;
    dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), "innocence-workbench-ipc-"));
    roots.push(dataRoot);
    registerWorkbenchIpc();
  });

  it("creates, lists and removes workbenches through the store root", async () => {
    const created = await mocks.handlers.get("workbench:create")!(null, " 面板 A ") as { id: string; dir: string };
    expect(created.id).toBeTruthy();
    expect(created.dir).toBe(path.join(dataRoot, "workbench", created.id));
    const listed = await mocks.handlers.get("workbench:list")!(null) as { id: string }[];
    expect(listed.map((row) => row.id)).toEqual([created.id]);
    await mocks.handlers.get("workbench:remove")!(null, created.id);
    expect(await mocks.handlers.get("workbench:list")!(null)).toEqual([]);
    await expect(mocks.handlers.get("workbench:remove")!(null, "../escape")).rejects.toThrow("Invalid workbench id");
  });

  it("watch/unwatch validate the id and tolerate a real directory watch", async () => {
    const created = await mocks.handlers.get("workbench:create")!(null, "watch me") as { id: string };
    await expect(mocks.handlers.get("workbench:watch")!(null, "../bad")).rejects.toThrow("Invalid workbench id");
    await mocks.handlers.get("workbench:watch")!(null, created.id);
    await mocks.handlers.get("workbench:watch")!(null, created.id); // 幂等
    await mocks.handlers.get("workbench:unwatch")!(null, created.id);
    await mocks.handlers.get("workbench:unwatch")!(null, created.id); // 重复释放无副作用
  });
});

describe("createWorkbenchWatchRegistry", () => {
  it("debounces change events into one touch + broadcast and ignores the meta file", () => {
    vi.useFakeTimers();
    try {
      const listeners = new Map<string, (filename: string | null) => void>();
      const closed: string[] = [];
      const touched: string[] = [];
      const broadcasted: string[] = [];
      const registry = createWorkbenchWatchRegistry({
        dirFor: (id) => `/root/${id}`,
        touch: async (id) => { touched.push(id); },
        broadcast: (id) => broadcasted.push(id),
        watchDir: (dir, listener) => {
          listeners.set(dir, listener);
          return { close: () => { closed.push(dir); listeners.delete(dir); } };
        },
      });
      registry.watch("a");
      registry.watch("a"); // 幂等：同一目录只有一个监听器
      expect(listeners.size).toBe(1);
      const listener = listeners.get("/root/a")!;
      listener("index.html");
      listener("workbench.json"); // 元数据回写忽略（防自激）
      listener("style.css");
      vi.advanceTimersByTime(199);
      expect(broadcasted).toEqual([]);
      vi.advanceTimersByTime(1);
      expect(touched).toEqual(["a"]);
      expect(broadcasted).toEqual(["a"]);
      listener("index.html");
      registry.unwatch("a");
      vi.advanceTimersByTime(500);
      expect(broadcasted).toEqual(["a"]); // 释放后不再触发
      expect(closed).toEqual(["/root/a"]);
      registry.watch("b");
      registry.dispose();
      expect(registry.watched()).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });
});
