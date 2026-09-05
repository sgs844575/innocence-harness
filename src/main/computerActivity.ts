import { nativeTheme } from "electron";
import type { ToolActivityObserver } from "@innocenceharness/harness-tools";
import { createComputerActivityStore } from "@innocenceharness/tools-computer/activity";
import { createComputerActivityWindow } from "./computerActivityWindow";
import { getTheme } from "./theme";
import { logger } from "./logger";

let observer: ToolActivityObserver | undefined;
let dispose: (() => void) | undefined;

/** Stable port shared by dynamically staged native and protocol tools. */
export const computerActivity: ToolActivityObserver = {
  begin: (activity) => observer?.begin(activity) ?? (() => {}),
};

export function initComputerActivity(getLocale: () => string, stopSession: (sessionId: string) => void | Promise<void>) {
  dispose?.();
  const store = createComputerActivityStore();
  const surface = createComputerActivityWindow(
    () => ({ activity: store.getSnapshot(), theme: getTheme().resolved, locale: getLocale() }),
    async () => {
      const results = await Promise.allSettled(store.activeSessionIds().map((id) => Promise.resolve().then(() => stopSession(id))));
      const failed = results.find((result) => result.status === "rejected");
      if (failed?.status === "rejected") throw failed.reason;
    },
  );
  let presentation = Promise.resolve();
  const refresh = () => {
    presentation = surface.present().catch((error) => logger.warn("Computer activity surface unavailable", { error: String(error) }));
  };
  const unsubscribe = store.subscribe(refresh);
  nativeTheme.on("updated", refresh);
  observer = {
    async begin(activity) {
      const finish = store.begin(activity);
      await presentation;
      return finish;
    },
  };
  dispose = () => {
    observer = undefined;
    unsubscribe();
    nativeTheme.removeListener("updated", refresh);
    store.dispose();
    surface.dispose();
  };
}

export function disposeComputerActivity() { dispose?.(); dispose = undefined; }
