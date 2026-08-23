import type { Context, EffectHandle, ObjectPlugin } from "@innocencecode/kernel";

export interface TimerService {
  setTimeout(callback: () => void, delayMs: number): number;
  setInterval(callback: () => void, delayMs: number): number;
  clear(id: number): void;
}

type TimerHandle = {
  handle: ReturnType<typeof globalThis.setTimeout>;
  effect: EffectHandle;
};

export const TimerPlugin: ObjectPlugin = {
  name: "kernel-timer",
  apply(ctx: Context) {
    let nextId = 0;
    const handles = new Map<number, TimerHandle>();
    const service: TimerService = {
      setTimeout(callback, delayMs) {
        const id = nextId++;
        let handle!: ReturnType<typeof globalThis.setTimeout>;
        const effect = ctx.effect(() => () => {
          globalThis.clearTimeout(handle);
          handles.delete(id);
        }, `timer ${id}`);
        handle = globalThis.setTimeout(() => {
          try { callback(); } catch { /* callbacks cannot break the owner fiber */ }
          finally { effect(); }
        }, delayMs);
        handles.set(id, { handle, effect });
        return id;
      },
      setInterval(callback, delayMs) {
        const id = nextId++;
        let handle!: ReturnType<typeof globalThis.setInterval>;
        const effect = ctx.effect(() => () => {
          globalThis.clearInterval(handle);
          handles.delete(id);
        }, `timer ${id}`);
        handle = globalThis.setInterval(() => {
          try { callback(); } catch { /* callbacks cannot break the owner fiber */ }
        }, delayMs);
        handles.set(id, { handle, effect });
        return id;
      },
      clear(id) {
        handles.get(id)?.effect();
      },
    };
    const off = ctx.provide("timer", service);
    return () => { off(); };
  },
};

declare module "@innocencecode/kernel" {
  interface Context { timer: TimerService }
}
