export interface RendererReadyStartupOptions {
  recover(): Promise<void>;
  startAutomation(): void;
  logRecoveryFailure(error: unknown): void;
  logAutomationStartFailure(error: unknown): void;
}

export interface RendererReadyStartup {
  readonly completion: Promise<void>;
  onRendererReady(): Promise<void>;
  block(): void;
}

/** Owns the single renderer-dependent startup task and its shutdown barrier. */
export function createRendererReadyStartup(options: RendererReadyStartupOptions): RendererReadyStartup {
  let state: "idle" | "running" | "settled" | "blocked" = "idle";
  let runner: Promise<void> | undefined;
  let resolveCompletion: (() => void) | undefined;
  const completion = new Promise<void>((resolve) => {
    resolveCompletion = resolve;
  });

  const settle = (): void => {
    state = "settled";
    resolveCompletion?.();
    resolveCompletion = undefined;
  };

  const safelyLog = (log: () => void): void => {
    try {
      log();
    } catch (loggingError) {
      void loggingError;
      // Logging must not interrupt startup cleanup or leave its owner rejected.
    }
  };

  return {
    completion,

    onRendererReady(): Promise<void> {
      if (state === "blocked") return completion;
      if (state === "running" || state === "settled") return runner ?? completion;
      state = "running";
      runner = (async () => {
        try {
          await options.recover();
        } catch (error) {
          safelyLog(() => options.logRecoveryFailure(error));
        } finally {
          try {
            options.startAutomation();
          } catch (error) {
            safelyLog(() => options.logAutomationStartFailure(error));
          } finally {
            settle();
          }
        }
      })();
      return runner;
    },

    block(): void {
      if (state !== "idle") return;
      state = "blocked";
      resolveCompletion?.();
      resolveCompletion = undefined;
    },
  };
}
