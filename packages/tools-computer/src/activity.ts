import type { ToolActivityStart, FinishToolActivity, ToolActivityOutcome } from "@innocenceharness/harness-tools";

export interface ComputerActivitySnapshot {
  toolName: string;
  status: "running" | ToolActivityOutcome;
  activeCount: number;
  startedAt: number;
  canStop: boolean;
}

/** Aggregates concurrent operations, keeping completion visible briefly between calls. */
export function createComputerActivityStore(settleDelayMs = 1400) {
  const active = new Map<string, { activity: ToolActivityStart; startedAt: number; detach: () => void }>();
  const listeners = new Set<(snapshot: ComputerActivitySnapshot | null) => void>();
  let snapshot: ComputerActivitySnapshot | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  let batchOutcome: ToolActivityOutcome = "success";
  const emit = () => { for (const listener of listeners) listener(snapshot); };
  const running = () => {
    const entries = [...active.values()];
    const latest = entries.at(-1)!;
    snapshot = {
      toolName: latest.activity.toolName, status: "running", activeCount: entries.length,
      startedAt: Math.min(...entries.map((entry) => entry.startedAt)),
      canStop: entries.some((entry) => Boolean(entry.activity.scope.sessionId)),
    };
    emit();
  };
  return {
    getSnapshot: () => snapshot,
    activeSessionIds: () => [...new Set([...active.values()].flatMap(({ activity }) => activity.scope.sessionId ? [activity.scope.sessionId] : []))],
    subscribe(listener: (snapshot: ComputerActivitySnapshot | null) => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    begin(activity: ToolActivityStart): FinishToolActivity {
      if (disposed || activity.signal.aborted) return () => {};
      if (timer) clearTimeout(timer);
      if (!active.size) batchOutcome = "success";
      const id = activity.scope.invocationId;
      let done = false;
      const finish: FinishToolActivity = (outcome) => {
        if (done || disposed) return;
        done = true;
        active.get(id)?.detach();
        active.delete(id);
        if (outcome === "error" || (outcome === "cancelled" && batchOutcome !== "error")) batchOutcome = outcome;
        if (active.size) return running();
        snapshot = { ...snapshot!, status: batchOutcome, activeCount: 0, canStop: false };
        emit();
        timer = setTimeout(() => { snapshot = null; timer = undefined; emit(); }, settleDelayMs);
      };
      const aborted = () => finish("cancelled");
      activity.signal.addEventListener("abort", aborted, { once: true });
      active.set(id, { activity, startedAt: Date.now(), detach: () => activity.signal.removeEventListener("abort", aborted) });
      running();
      return finish;
    },
    dispose() {
      disposed = true;
      if (timer) clearTimeout(timer);
      for (const entry of active.values()) entry.detach();
      active.clear();
      snapshot = null;
      emit();
      listeners.clear();
    },
  };
}
