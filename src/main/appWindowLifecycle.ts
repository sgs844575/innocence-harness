export interface AppWindowLifecycleOptions<Window> {
  createMainWindow(onRendererReady?: () => void): Promise<Window>;
  getMainWindow(): Window | undefined;
  onInitialRendererReady(): void;
}

export interface AppWindowLifecycle<Window> {
  createInitialWindow(): Promise<Window>;
  activate(): Promise<void>;
}

/** Owns initial-window startup injection and de-duplicates window recreation. */
export function createAppWindowLifecycle<Window>(
  options: AppWindowLifecycleOptions<Window>,
): AppWindowLifecycle<Window> {
  let recreation: Promise<Window> | undefined;

  return {
    createInitialWindow: () => options.createMainWindow(options.onInitialRendererReady),

    async activate(): Promise<void> {
      if (options.getMainWindow() !== undefined) return;
      if (!recreation) {
        recreation = options.createMainWindow().finally(() => {
          recreation = undefined;
        });
      }
      await recreation;
    },
  };
}
