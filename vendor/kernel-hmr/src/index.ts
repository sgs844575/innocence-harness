import type { Context, ObjectPlugin } from "@innocencecode/kernel";

export interface HmrService {
  watch(id: string, restart: () => Promise<void>): () => void;
  restart(id: string): Promise<void>;
  stop(id: string): Promise<void>;
}

export const HmrPlugin: ObjectPlugin = {
  name: "kernel-hmr",
  apply(ctx: Context) {
    const callbacks = new Map<string, () => Promise<void>>();
    const service: HmrService = {
      watch(id, restart) {
        callbacks.set(id, restart);
        let active = true;
        const off = ctx.effect(() => () => {
          if (active && callbacks.get(id) === restart) callbacks.delete(id);
          active = false;
        }, `hmr ${id}`);
        return () => { off(); };
      },
      async restart(id) {
        const callback = callbacks.get(id);
        if (!callback) throw new Error(`hmr target not found: ${id}`);
        await callback();
      },
      async stop(id) {
        const callback = callbacks.get(id);
        if (!callback) return;
        callbacks.delete(id);
        // The callback remains owned by its effect; stop only disables its route.
      },
    };
    return ctx.provide("hmr", service);
  },
};

declare module "@innocencecode/kernel" {
  interface Context { hmr: HmrService }
}
