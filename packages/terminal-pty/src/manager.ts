// PtyManager — the registry of route-bound PTY sessions. One session per
// (taskId, routeId) pair; creating for an occupied pair replaces the old
// session (dispose first), so a stale renderer can never type into a shell
// that belongs to a different route cwd.
import {
  LivePtySession,
  type PtyEvent,
  type PtySession,
  type PtySessionFactory,
} from "./pty";

export interface PtyManagerOptions {
  /** Every output chunk and the final exit, each carrying the identity triple. */
  readonly onEvent?: (event: PtyEvent) => void;
  readonly log?: (level: "info" | "warn" | "error", msg: string, data?: unknown) => void;
  readonly createSession?: PtySessionFactory;
}

export interface PtyManager {
  create(input: { taskId: string; routeId: string; cwd: string; cols?: number; rows?: number }): Promise<PtySession>;
  /** The live session for a task route, if any. */
  get(taskId: string, routeId: string): PtySession | undefined;
  disposeForRoute(taskId: string, routeId: string): Promise<void>;
  disposeAll(): Promise<void>;
}

let mintSeq = 0;
const mintPtyId = () => `pty_${Date.now().toString(36)}_${(mintSeq++).toString(36)}`;

const routeKey = (taskId: string, routeId: string) => `${taskId}::${routeId}`;

const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;

function sanitizeDimension(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 2 && value <= 500
    ? value
    : fallback;
}

export function createPtyManager(options: PtyManagerOptions = {}): PtyManager {
  const log = options.log ?? (() => {});
  const sessions = new Map<string, PtySession>();
  const routeQueues = new Map<string, Promise<void>>();
  let closing = false;
  let disposeAllPromise: Promise<void> | undefined;
  const createSession = options.createSession ?? ((init, sessionOptions) => new LivePtySession(init, sessionOptions));

  function enqueueRoute<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const previous = routeQueues.get(key) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(operation);
    const tail = current.then(() => undefined, () => undefined);
    routeQueues.set(key, tail);
    void tail.finally(() => {
      if (routeQueues.get(key) === tail) routeQueues.delete(key);
    });
    return current;
  }

  const disposeRouteNow = async (taskId: string, routeId: string): Promise<void> => {
    const key = routeKey(taskId, routeId);
    const session = sessions.get(key);
    if (!session) return;
    sessions.delete(key);
    await session.dispose().catch((error) =>
      log("warn", "pty dispose failed", `${taskId}/${routeId}: ${String(error)}`),
    );
  };

  const disposeForRoute = (taskId: string, routeId: string): Promise<void> =>
    enqueueRoute(routeKey(taskId, routeId), () => disposeRouteNow(taskId, routeId));

  return {
    async create(input) {
      if (!input.taskId || !input.routeId) {
        throw new Error("pty manager: create requires taskId and routeId");
      }
      if (closing) throw new Error("pty manager: disposing");
      return enqueueRoute(routeKey(input.taskId, input.routeId), async () => {
        if (closing) throw new Error("pty manager: disposing");
        // Same-route re-create replaces: the old shell never outlives its route.
        await disposeRouteNow(input.taskId, input.routeId);
        if (closing) throw new Error("pty manager: disposing");
        const session = createSession(
          {
            ptyId: mintPtyId(),
            taskId: input.taskId,
            routeId: input.routeId,
            cwd: input.cwd,
            cols: sanitizeDimension(input.cols, DEFAULT_COLS),
            rows: sanitizeDimension(input.rows, DEFAULT_ROWS),
          },
          {
            onEvent: (event) => options.onEvent?.(event),
            onGone: (gone) => {
              const key = routeKey(gone.taskId, gone.routeId);
              if (sessions.get(key) === gone) sessions.delete(key);
            },
          },
        );
        sessions.set(routeKey(input.taskId, input.routeId), session);
        log("info", "pty created", `${input.taskId}/${input.routeId} -> ${session.ptyId}`);
        return session;
      });
    },
    get: (taskId, routeId) => sessions.get(routeKey(taskId, routeId)),
    disposeForRoute,
    async disposeAll() {
      if (disposeAllPromise) {
        await disposeAllPromise;
        return;
      }
      closing = true;
      disposeAllPromise = (async () => {
        while (routeQueues.size > 0) {
          await Promise.all([...routeQueues.values()]);
        }
        await Promise.all([...sessions.values()].map((session) => disposeRouteNow(session.taskId, session.routeId)));
      })();
      await disposeAllPromise;
    },
  };
}
