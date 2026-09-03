// Session-level registry of spawned subagent runs. The spawner service owns
// one registry per session; the TaskStatus tool and the auto-progress drain
// read it. Registry entries back the detached-spawn lifecycle: a run spawned
// via start() outlives its tool call, so its state must live somewhere the
// rest of the session can query.

import type { SubagentRunInfo, SubagentStatus } from "./subagent";

/** Terminal run statuses (mirrors the lifecycle terminal set). */
const TERMINAL: ReadonlySet<SubagentStatus> = new Set(["completed", "failed", "cancelled"]);

/** Cap on retained FINISHED records; live records are never pruned. */
export const FINISHED_RECORD_LIMIT = 50;

/** One registered run: mutable live info plus its control handles. */
export interface SubagentRunRecord {
  /** Live view — the spawner mutates it as lifecycle events arrive. */
  readonly info: SubagentRunInfo;
  /** True for runs spawned detached (start); only those queue progress notes. */
  readonly detached: boolean;
  /** Aborts the run's own controller (linked to the spawning signal).
   *  Reassigned on resume so cancel always reaches the CURRENT controller. */
  abort: () => void;
  /** Latest-wins pending progress note for the auto-report drain. */
  pendingNote?: string;
  /** Resolve functions parked in wait() until the run turns terminal. */
  readonly waiters: Array<() => void>;
}

export interface SubagentRunRegistry {
  /** Registers a new running record. */
  create(input: {
    runId: string;
    agentType?: string;
    description: string;
    detached: boolean;
    abort: () => void;
  }): SubagentRunRecord;
  /** Live record lookup (internal mutation path). */
  record(runId: string): SubagentRunRecord | undefined;
  /** Snapshot copies of every record, insertion order (oldest first). */
  list(): readonly SubagentRunInfo[];
  /**
   * Queues a progress note for the auto-report drain. Only detached runs
   * queue notes — a blocking run's progress already streams into the parent
   * timeline tool row, so reporting it again would be noise. Non-terminal
   * notes are latest-wins; terminal notes always land.
   */
  note(record: SubagentRunRecord, text: string): void;
  /** Takes every pending note (formatted lines) and clears them. */
  drainProgress(): string[];
  /**
   * Resolves with a snapshot once the run is terminal; with `timeoutMs`
   * given, resolves with the live snapshot when the deadline passes instead
   * of rejecting. Unknown runId rejects.
   */
  wait(runId: string, timeoutMs?: number): Promise<SubagentRunInfo>;
  /** Aborts a run by id and returns its live snapshot; unknown id throws. */
  cancel(runId: string): SubagentRunInfo;
  /** Aborts every non-terminal run (session teardown). */
  abortActive(): void;
  /** Marks a run terminal: stamps finish fields and releases waiters. */
  settle(record: SubagentRunRecord, patch: Partial<SubagentRunInfo> & { status: SubagentStatus }): void;
}

export function createRunRegistry(): SubagentRunRegistry {
  const records = new Map<string, SubagentRunRecord>();

  const snapshot = (record: SubagentRunRecord): SubagentRunInfo => ({ ...record.info });

  const pruneFinished = () => {
    const finished = [...records.values()].filter((r) => TERMINAL.has(r.info.status));
    if (finished.length <= FINISHED_RECORD_LIMIT) return;
    finished.sort((a, b) => a.info.startedAt - b.info.startedAt);
    for (const record of finished.slice(0, finished.length - FINISHED_RECORD_LIMIT)) {
      records.delete(record.info.runId);
    }
  };

  return {
    create(input) {
      const record: SubagentRunRecord = {
        info: {
          runId: input.runId,
          ...(input.agentType ? { agentType: input.agentType } : {}),
          description: input.description,
          status: "started",
          startedAt: Date.now(),
          toolCalls: 0,
        },
        detached: input.detached,
        abort: input.abort,
        waiters: [],
      };
      records.set(input.runId, record);
      return record;
    },
    record: (runId) => records.get(runId),
    list: () => [...records.values()].map(snapshot),
    note(record, text) {
      if (!record.detached) return;
      record.pendingNote = text;
    },
    drainProgress() {
      const notes: string[] = [];
      for (const record of records.values()) {
        if (record.pendingNote) {
          notes.push(record.pendingNote);
          record.pendingNote = undefined;
        }
      }
      return notes;
    },
    wait(runId, timeoutMs) {
      const record = records.get(runId);
      if (!record) return Promise.reject(new Error(`未知的子代理运行：${runId}`));
      if (TERMINAL.has(record.info.status)) return Promise.resolve(snapshot(record));
      return new Promise((resolve) => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const wake = () => {
          if (timer) clearTimeout(timer);
          const parked = record.waiters.indexOf(wake);
          if (parked >= 0) record.waiters.splice(parked, 1);
          resolve(snapshot(record));
        };
        record.waiters.push(wake);
        if (timeoutMs !== undefined && Number.isFinite(timeoutMs) && timeoutMs > 0) {
          timer = setTimeout(wake, timeoutMs);
        }
      });
    },
    cancel(runId) {
      const record = records.get(runId);
      if (!record) throw new Error(`未知的子代理运行：${runId}`);
      if (!TERMINAL.has(record.info.status)) record.abort();
      return snapshot(record);
    },
    abortActive() {
      for (const record of records.values()) {
        if (!TERMINAL.has(record.info.status)) record.abort();
      }
    },
    settle(record, patch) {
      Object.assign(record.info, patch, { finishedAt: Date.now() });
      const waiters = record.waiters.splice(0);
      for (const wake of waiters) wake();
      pruneFinished();
    },
  };
}
