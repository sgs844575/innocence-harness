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
  restartPromise?: Promise<void>;
  pending: boolean;
  disposed: boolean;
}

export function createHostHmrWatcher(options: HostHmrWatcherOptions = {}): HostHmrWatcher {
  const debounceMs = Math.max(0, options.debounceMs ?? 50);
  const fsWatch = options.fsWatch ?? fs.watch;
  const log = options.log ?? (() => {});
  const registrations = new Map<string, Registration>();
  const replacementQueues = new Map<string, Promise<void>>();
  let disposed = false;

  const logWatcherError = (registration: Pick<Registration, "id" | "fileOrDirectory">, error: unknown): void => {
    log("error", `HMR watcher failed for "${registration.id}"`, {
      id: registration.id,
      path: registration.fileOrDirectory,
      error,
    });
  };

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
    await registration.restartPromise;
  };

  const runRestart = async (registration: Registration): Promise<void> => {
    if (registration.disposed) return;
    if (registration.restartPromise) {
      registration.pending = true;
      return;
    }
    let current!: Promise<void>;
    current = Promise.resolve()
      .then(() => registration.restart())
      .catch((error: unknown) => {
        log("error", `HMR restart failed for "${registration.id}"`, {
          id: registration.id,
          path: registration.fileOrDirectory,
          error,
        });
      })
      .finally(() => {
        if (registration.restartPromise === current) registration.restartPromise = undefined;
        if (registration.pending && !registration.disposed) {
          registration.pending = false;
          scheduleRestart(registration);
        }
      });
    registration.restartPromise = current;
    await current;
  };

  const scheduleRestart = (registration: Registration): void => {
    if (registration.disposed) return;
    if (registration.timer !== undefined) clearTimeout(registration.timer);
    registration.timer = setTimeout(() => {
      registration.timer = undefined;
      void runRestart(registration);
    }, debounceMs);
  };

  const watchPath = (
    id: string,
    fileOrDirectory: string,
    restart: () => Promise<void>,
  ): Promise<() => Promise<void>> => {
    if (disposed) return Promise.reject(new Error("host HMR watcher is disposed"));
    if (!id || !fileOrDirectory) {
      return Promise.reject(new Error("HMR watch registration requires an id and path"));
    }

    const previousQueue = replacementQueues.get(id) ?? Promise.resolve();
    const operation = previousQueue.catch(() => undefined).then(async () => {
      if (disposed) throw new Error("host HMR watcher is disposed");
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

      let registration: Registration | undefined;
      const onError = (error: Error): void => {
        if (registration) {
          logWatcherError(registration, error);
          void disposeRegistration(registration).catch((disposeError: unknown) => {
            logWatcherError(registration!, disposeError);
          });
        } else {
          logWatcherError({ id, fileOrDirectory }, error);
          watcher.close();
        }
      };
      watcher.on("error", onError);
      registration = {
        id,
        fileOrDirectory,
        restart,
        watcher,
        pending: false,
        disposed: false,
      };
      registrations.set(id, registration);
      return async (): Promise<void> => {
        await disposeRegistration(registration!);
      };
    });
    const settled = operation.then(() => undefined, () => undefined);
    replacementQueues.set(id, settled);
    void settled.then(() => {
      if (replacementQueues.get(id) === settled) replacementQueues.delete(id);
    });
    return operation;
  };

  return {
    watchPath,
    async dispose(): Promise<void> {
      if (disposed) return;
      disposed = true;
      await Promise.all([...replacementQueues.values()]);
      const current = [...registrations.values()];
      await Promise.all(current.map(disposeRegistration));
    },
  };
}
