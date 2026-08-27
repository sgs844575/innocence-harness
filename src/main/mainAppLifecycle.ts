import { createAppWindowLifecycle, type AppWindowLifecycle } from "./appWindowLifecycle";
import {
  createRendererReadyStartup,
  type RendererReadyStartup,
  type RendererReadyStartupOptions,
} from "./rendererReadyStartup";

export interface MainAppLifecycleOptions<Window> extends RendererReadyStartupOptions {
  createMainWindow(onRendererReady?: () => void): Promise<Window>;
  getMainWindow(): Window | undefined;
}

export interface MainAppLifecycle<Window> extends AppWindowLifecycle<Window> {
  startup: RendererReadyStartup;
}

/** Composes the main process's one-shot startup with window recreation. */
export function createMainAppLifecycle<Window>(options: MainAppLifecycleOptions<Window>): MainAppLifecycle<Window> {
  const startup = createRendererReadyStartup(options);
  const windows = createAppWindowLifecycle({
    createMainWindow: options.createMainWindow,
    getMainWindow: options.getMainWindow,
    onInitialRendererReady: startup.onRendererReady,
  });
  return { ...windows, startup };
}
