export interface RendererReadyStartupOptions {
  recover(): Promise<void>;
  startAutomation(): void;
  logRecoveryFailure(error: unknown): void;
  logAutomationStartFailure(error: unknown): void;
}

export interface RendererReadyStartup {
  readonly completion: Promise<void>;
  onRendererReady(): void;
  block(): void;
}

/** Owns the single renderer-dependent startup task and its shutdown barrier. */
export function createRendererReadyStartup(options: RendererReadyStartupOptions): RendererReadyStartup {
  let state: "idle" | "running" | "settled" | "blocked" = "idle";
  let resolveCompletion: (() => void) | undefined;
  const completion = new Promise<void>((resolve) => {
    resolveCompletion = resolve;
  });

  const settle = (): void => {
    state = "settled";
    resolveCompletion?.();
    resolveCompletion = undefined;
  };

  return {
    completion,

    onRendererReady(): void {
      if (state !== "idle") return;
      state = "running";
      void (async () => {
        try {
          await options.recover();
        } catch (error) {
          options.logRecoveryFailure(error);
        } finally {
          try {
            options.startAutomation();
          } catch (error) {
            options.logAutomationStartFailure(error);
          } finally {
            settle();
          }
        }
      })();
    },

    block(): void {
      if (state !== "idle") return;
      state = "blocked";
      resolveCompletion?.();
      resolveCompletion = undefined;
    },
  };
}
