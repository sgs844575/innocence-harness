import { useEffect, useRef } from "react";
import type { TerminalCollectionState } from "./terminalState";

export interface TerminalActivitySummary {
  durationMs: number;
  backgroundTasks: number;
}

export function useTerminalActivityProjection(
  collection: TerminalCollectionState,
  onActivityChange?: (activity: TerminalActivitySummary) => void,
): void {
  const startedAtRef = useRef<number | null>(null);

  useEffect(() => () => {
    onActivityChange?.({ durationMs: 0, backgroundTasks: 0 });
  }, [onActivityChange]);

  useEffect(() => {
    let running = 0;
    for (const ptyId of collection.order) {
      if (!collection.entries[ptyId]?.exited) running += 1;
    }
    if (running > 0 && startedAtRef.current === null) startedAtRef.current = Date.now();
    if (running === 0) startedAtRef.current = null;

    const publish = () => onActivityChange?.({
      durationMs: startedAtRef.current === null ? 0 : Math.max(0, Date.now() - startedAtRef.current),
      backgroundTasks: running,
    });
    publish();
    if (running === 0 || !onActivityChange) return;
    const timer = window.setInterval(publish, 1_000);
    return () => window.clearInterval(timer);
  }, [collection, onActivityChange]);
}
