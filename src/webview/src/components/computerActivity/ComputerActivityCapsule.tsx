import { useEffect, useState } from "react";
import { Check, CircleAlert, MousePointer2, Square } from "lucide-react";
import type { ComputerActivityViewState } from "../../../../shared/computerActivity";
import { activityCopy } from "./copy";

export function ComputerActivityCapsule({ state, onStop, onHover }: {
  state: ComputerActivityViewState;
  onStop(): Promise<void>;
  onHover(inside: boolean): void;
}) {
  const [now, setNow] = useState(Date.now);
  const [stopping, setStopping] = useState(false);
  const [stopFailed, setStopFailed] = useState(false);
  const activity = state.activity;
  useEffect(() => {
    setStopping(false);
    setStopFailed(false);
  }, [activity?.startedAt, activity?.status]);
  useEffect(() => {
    if (activity?.status !== "running") return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [activity?.status]);
  if (!activity) return null;
  const labels = activityCopy(state.locale, activity);
  const running = activity.status === "running";
  const Icon = running ? MousePointer2 : activity.status === "success" ? Check : activity.status === "error" ? CircleAlert : Square;
  const elapsed = Math.max(0, Math.floor((now - activity.startedAt) / 1000));
  return (
    <section className="computer-activity-capsule rise-in" data-testid="computer-activity-capsule" data-status={activity.status}
      onPointerEnter={() => onHover(true)} onPointerLeave={() => onHover(false)}>
      <div className="computer-activity-icon" aria-hidden="true">
        <Icon size={20} strokeWidth={1.5} />
        {running && <span className="computer-activity-dot" />}
      </div>
      <div className="min-w-0 flex-1" role="status" aria-live="polite" aria-atomic="true">
        <div className="truncate text-sm font-medium text-(--color-foreground-strong)">{labels.title}</div>
        <div className="mt-0.5 truncate text-xs text-(--color-muted)">{stopFailed ? labels.stopError : labels.detail}</div>
      </div>
      {running && <span className="text-xs tabular-nums text-(--color-faint)" aria-hidden="true">{Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, "0")}</span>}
      {running && activity.canStop && <button type="button" className="computer-activity-stop" disabled={stopping}
        aria-label={labels.stopLabel} title={labels.stopLabel}
        onClick={async () => {
          setStopping(true);
          setStopFailed(false);
          try { await onStop(); }
          catch { setStopFailed(true); setStopping(false); }
        }}>
        <Square size={10} fill="currentColor" strokeWidth={1.5} aria-hidden="true" />
        {stopping ? labels.stopping : labels.stop}
      </button>}
    </section>
  );
}
