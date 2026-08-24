import fs, { type FSWatcher } from "node:fs";

export interface HostHmrWatcherOptions {
  debounceMs?: number;
  fsWatch?: typeof fs.watch;
  log?: (level: "warn" | "error", message: string, data?: unknown) => void;
}

export interface HostHmrWatcher {
  watchPath(id: string, fileOrDirectory: string, restart: () => Promise<void>): Promise<() => Promise<void>>;
  dispose(): Promise<void>;
}

interface Registration {
  readonly id: string;
  readonly fileOrDirectory: string;
  readonly restart: () => Promise<void>;
  readonly watcher: FSWatcher;
  timer?: ReturnType<typeof setTimeout>;
  running: boolean;
  pending: boolean;
  disposed: boolean;
}

export function createHostHmrWatcher(options: HostHmrWatcherOptions = {}): HostHmrWatcher {
  const debounceMs = Math.max(0, options.debounceMs ?? 50);
  const fsWatch = options.fsWatch ?? fs.watch;
  const log = options.log ?? (() => {});
  const registrations = new Map<string, Registration>();
  let disposed = false;

  const disposeRegistration = async (registration: Registration): Promise<void> => {
    if (registration.disposed) return;
    registration.disposed = true;
    if (registration.timer !== undefined) {
      clearTimeout(registration.timer);
      registration.timer = undefined;
    }
    if (registrations.get(registration.id) === registration) {
      registrations.delete(registration.id);
    }
    registration.watcher.close();
  };

  const scheduleRestart = (registration: Registration): void => {
    if (registration.disposed) return;
    if (registration.timer !== undefined) clearTimeout(registration.timer);
    registration.timer = setTimeout(() => {
      registration.timer = undefined;
      void runRestart(registration);
    }, debounceMs);
  };

  const runRestart = async (registration: Registration): Promise<void> => {
    if (registration.disposed) return;
    if (registration.running) {
      registration.pending = true;
      return;
    }
    registration.running = true;
    try {
      await registration.restart();
    } catch (error) {
      log("error", `HMR restart failed for "${registration.id}"`, {
        id: registration.id,
        path: registration.fileOrDirectory,
        error,
      });
    } finally {
      registration.running = false;
      if (registration.pending && !registration.disposed) {
        registration.pending = false;
        scheduleRestart(registration);
      }
    }
  };

  const watchPath = async (
    id: string,
    fileOrDirectory: string,
    restart: () => Promise<void>,
  ): Promise<() => Promise<void>> => {
    if (disposed) throw new Error("host HMR watcher is disposed");
    if (!id || !fileOrDirectory) throw new Error("HMR watch registration requires an id and path");
    const previous = registrations.get(id);
    if (previous) await disposeRegistration(previous);

    let watcher: FSWatcher;
    try {
      watcher = fsWatch(fileOrDirectory, (event) => {
        if (event === "change" || event === "rename") {
          const registration = registrations.get(id);
          if (registration) scheduleRestart(registration);
        }
      });
    } catch (cause) {
      throw new Error(`failed to start HMR watcher for "${id}"`, { cause });
    }

    const registration: Registration = {
      id,
      fileOrDirectory,
      restart,
      watcher,
      running: false,
      pending: false,
      disposed: false,
    };
    registrations.set(id, registration);
    const off = async (): Promise<void> => {
      await disposeRegistration(registration);
    };
    return off;
  };

  return {
    watchPath,
    async dispose(): Promise<void> {
      if (disposed) return;
      disposed = true;
      const current = [...registrations.values()];
      await Promise.all(current.map(disposeRegistration));
    },
  };
}
