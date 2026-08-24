import { closeSync, mkdtempSync, openSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { FSWatcher } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { createHostHmrWatcher } from "./hmrWatcher";

interface FakeWatchEvents {
  watch: typeof import("node:fs").watch;
  emit(event: string, filename: string): void;
  emitError(error: unknown): void;
  closeCount(): number;
  openCount(): number;
}

function createFakeWatchEvents(): FakeWatchEvents {
  const listeners = new Set<(event: string, filename: string) => void>();
  const errorListeners = new Set<(error: unknown) => void>();
  let closes = 0;
  let opens = 0;
  const watch = ((_path: string, listener: (event: string, filename: string) => void) => {
    listeners.add(listener);
    opens += 1;
    return {
      on(event: string, errorListener: (error: unknown) => void) {
        if (event === "error") errorListeners.add(errorListener);
        return this;
      },
      close() {
        closes += 1;
        listeners.delete(listener);
        errorListeners.clear();
      },
    } as FSWatcher;
  }) as typeof import("node:fs").watch;
  return {
    watch,
    emit(event, filename) {
      for (const listener of [...listeners]) listener(event, filename);
    },
    emitError(error) {
      for (const listener of [...errorListeners]) listener(error);
    },
    closeCount: () => closes,
    openCount: () => opens,
  };
}

async function waitUntil(predicate: () => boolean, timeoutMs = 1_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("condition did not settle");
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
}

describe("host HMR watcher", () => {
  const roots: string[] = [];
  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  it("merges consecutive file events and runs restart serially", async () => {
    const events = createFakeWatchEvents();
    const calls: string[] = [];
    let release!: () => void;
    const running = new Promise<void>((resolve) => { release = resolve; });
    const watcher = createHostHmrWatcher({ fsWatch: events.watch, debounceMs: 5 });

    const off = await watcher.watchPath("example", "fixture/client.js", async () => {
      calls.push("start");
      await running;
      calls.push("end");
    });

    events.emit("change", "fixture/client.js");
    events.emit("change", "fixture/client.js");
    await waitUntil(() => calls.length === 1);
    release();
    await waitUntil(() => calls.length === 2);
    expect(calls).toEqual(["start", "end"]);
    await off();
    await watcher.dispose();
  });

  it("keeps a rejected restart registered so the next event can retry", async () => {
    const events = createFakeWatchEvents();
    const errors: unknown[] = [];
    let attempts = 0;
    const watcher = createHostHmrWatcher({ fsWatch: events.watch, debounceMs: 0,
      log: (_level, _message, data) => errors.push(data),
    });

    await watcher.watchPath("example", "fixture/client.js", async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("restart failed");
    });
    events.emit("change", "fixture/client.js");
    await waitUntil(() => attempts === 1);
    events.emit("change", "fixture/client.js");
    await waitUntil(() => attempts === 2);
    expect(errors).toHaveLength(1);
    await watcher.dispose();
  });

  it("cleans an opened watcher when the registration is disposed or the watcher is disposed", async () => {
    const events = createFakeWatchEvents();
    const watcher = createHostHmrWatcher({ fsWatch: events.watch, debounceMs: 0 });
    const off = await watcher.watchPath("example", "fixture/client.js", async () => {});
    await off();
    await off();
    expect(events.closeCount()).toBe(1);
    await watcher.dispose();
    await watcher.dispose();
    expect(events.closeCount()).toBe(1);
  });

  it("does not leave a registration when watch startup fails", async () => {
    const startupError = new Error("watch startup failed");
    const watcher = createHostHmrWatcher({
      fsWatch: (() => { throw startupError; }) as typeof import("node:fs").watch,
    });

    await expect(watcher.watchPath("example", "missing.js", async () => {}))
      .rejects.toMatchObject({ cause: startupError });
    await watcher.dispose();
  });

  it("handles asynchronous watcher errors without an uncaught exception", async () => {
    const events = createFakeWatchEvents();
    const errors: unknown[] = [];
    const watcher = createHostHmrWatcher({
      fsWatch: events.watch,
      log: (_level, _message, data) => errors.push(data),
    });

    await watcher.watchPath("example", "fixture/client.js", async () => {});
    events.emitError(new Error("watcher failed"));
    await waitUntil(() => events.closeCount() === 1);
    expect(errors).toHaveLength(1);
    events.emit("change", "fixture/client.js");
    await watcher.dispose();
    expect(events.closeCount()).toBe(1);
  });

  it("serializes concurrent replacement of the same id and closes every watcher", async () => {
    const events = createFakeWatchEvents();
    const watcher = createHostHmrWatcher({ fsWatch: events.watch });

    const first = watcher.watchPath("example", "fixture/one.js", async () => {});
    const second = watcher.watchPath("example", "fixture/two.js", async () => {});
    await Promise.all([first, second]);
    expect(events.openCount()).toBe(2);
    await watcher.dispose();
    expect(events.closeCount()).toBe(2);
  });

  it("waits for an in-flight restart before disposing its watcher", async () => {
    const events = createFakeWatchEvents();
    let release!: () => void;
    const running = new Promise<void>((resolve) => { release = resolve; });
    let started!: () => void;
    const startedPromise = new Promise<void>((resolve) => { started = resolve; });
    const watcher = createHostHmrWatcher({ fsWatch: events.watch, debounceMs: 0 });
    await watcher.watchPath("example", "fixture/client.js", async () => {
      started();
      return running;
    });
    events.emit("change", "fixture/client.js");
    await startedPromise;
    const disposing = watcher.dispose();
    let settled = false;
    void disposing.then(() => { settled = true; });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(settled).toBe(false);
    release();
    await disposing;
    expect(events.closeCount()).toBe(1);
  });

  it("waits for error-triggered disposal and restart before global dispose returns", async () => {
    const events = createFakeWatchEvents();
    let release!: () => void;
    const running = new Promise<void>((resolve) => { release = resolve; });
    let started!: () => void;
    const startedPromise = new Promise<void>((resolve) => { started = resolve; });
    const watcher = createHostHmrWatcher({ fsWatch: events.watch, debounceMs: 0 });
    await watcher.watchPath("example", "fixture/client.js", async () => {
      started();
      return running;
    });
    events.emit("change", "fixture/client.js");
    await startedPromise;
    events.emitError(new Error("watcher failed"));
    const disposing = watcher.dispose();
    let settled = false;
    void disposing.then(() => { settled = true; });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(settled).toBe(false);
    release();
    await disposing;
    expect(events.closeCount()).toBe(1);
  });

  it("uses the real Node watcher for file changes", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "ic-hmr-watcher-"));
    roots.push(root);
    const file = path.join(root, "client.js");
    closeSync(openSync(file, "w"));
    let restarts = 0;
    const watcher = createHostHmrWatcher({ debounceMs: 10 });
    await watcher.watchPath("example", file, async () => { restarts += 1; });
    writeFileSync(file, "changed", "utf8");
    await waitUntil(() => restarts === 1, 2_000);
    await watcher.dispose();
  });
});
