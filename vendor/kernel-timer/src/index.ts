import type { Context, ObjectPlugin } from "@innocencecode/kernel";

export interface TimerService {
  setTimeout(callback: () => void, delayMs: number): number;
  setInterval(callback: () => void, delayMs: number): number;
  clear(id: number): void;
}

type TimerHandle = {
  kind: "timeout" | "interval";
  handle: ReturnType<typeof globalThis.setTimeout>;
};

export const TimerPlugin: ObjectPlugin = {
  name: "kernel-timer",
  apply(ctx: Context) {
    let nextId = 0;
    const handles = new Map<number, TimerHandle>();
    const service: TimerService = {
      setTimeout(callback, delayMs) {
        const id = nextId++;
        const handle = globalThis.setTimeout(() => {
          handles.delete(id);
          try { callback(); } catch { /* callbacks cannot break the owner fiber */ }
        }, delayMs);
        handles.set(id, { kind: "timeout", handle });
        ctx.effect(() => () => {
          globalThis.clearTimeout(handle);
          handles.delete(id);
        }, `timer ${id}`);
        return id;
      },
      setInterval(callback, delayMs) {
        const id = nextId++;
        const handle = globalThis.setInterval(() => {
          try { callback(); } catch { /* callbacks cannot break the owner fiber */ }
        }, delayMs);
        handles.set(id, { kind: "interval", handle });
        ctx.effect(() => () => {
          globalThis.clearInterval(handle);
          handles.delete(id);
        }, `timer ${id}`);
        return id;
      },
      clear(id) {
        const timer = handles.get(id);
        if (!timer) return;
        if (timer.kind === "timeout") globalThis.clearTimeout(timer.handle);
        else globalThis.clearInterval(timer.handle);
        handles.delete(id);
      },
    };
    const off = ctx.provide("timer", service);
    return () => { off(); };
  },
};

declare module "@innocencecode/kernel" {
  interface Context { timer: TimerService }
}
