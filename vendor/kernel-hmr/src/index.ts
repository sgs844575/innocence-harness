import type { Context, ObjectPlugin } from "@innocenceharness/kernel";

export interface HmrService {
  watch(id: string, restart: () => Promise<void>): () => void;
  restart(id: string): Promise<void>;
  stop(id: string): Promise<void>;
}

export const HmrPlugin: ObjectPlugin = {
  name: "kernel-hmr",
  apply(ctx: Context) {
    type Registration = { restart: () => Promise<void>; off: () => void | Promise<void> };
    const callbacks = new Map<string, Registration>();
    const service: HmrService = {
      watch(id, restart) {
        callbacks.get(id)?.off();
        const registration = { restart, off: (() => {}) as () => void | Promise<void> };
        registration.off = ctx.effect(() => () => {
          if (callbacks.get(id) === registration) callbacks.delete(id);
        }, `hmr ${id}`);
        callbacks.set(id, registration);
        return () => { registration.off(); };
      },
      async restart(id) {
        const registration = callbacks.get(id);
        if (!registration) throw new Error(`hmr target not found: ${id}`);
        await registration.restart();
      },
      async stop(id) {
        const registration = callbacks.get(id);
        if (!registration) return;
        callbacks.delete(id);
        await registration.off();
      },
    };
    return ctx.provide("hmr", service);
  },
};

declare module "@innocenceharness/kernel" {
  interface Context { hmr: HmrService }
}
