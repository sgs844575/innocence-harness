export interface RendererReadyStartupOptions {
  recover(): Promise<void>;
  startAutomation(): void;
  logRecoveryFailure(error: unknown): void;
}

/** Runs renderer-dependent startup once, with lifecycle start in recovery finally. */
export function createRendererReadyStartup(options: RendererReadyStartupOptions): () => void {
  let started = false;

  return () => {
    if (started) return;
    started = true;
    void (async () => {
      try {
        await options.recover();
      } catch (error) {
        options.logRecoveryFailure(error);
      } finally {
        options.startAutomation();
      }
    })();
  };
}
