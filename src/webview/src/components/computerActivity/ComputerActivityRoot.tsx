import { useEffect, useState } from "react";
import type { ComputerActivityViewState } from "../../../../shared/computerActivity";
import { ComputerActivityCapsule } from "./ComputerActivityCapsule";
import "./computerActivity.css";

export function ComputerActivityRoot() {
  const [state, setState] = useState<ComputerActivityViewState>();
  useEffect(() => {
    const api = window.computerActivity;
    if (!api) return;
    let alive = true;
    let received = false;
    const update = (value: ComputerActivityViewState) => {
      if (!alive) return;
      document.documentElement.classList.toggle("dark", value.theme === "dark");
      document.documentElement.lang = value.locale;
      setState(value);
    };
    const unsubscribe = api.onChanged((value) => { received = true; update(value); });
    void api.get().then((value) => { if (!received) update(value); });
    return () => { alive = false; unsubscribe(); };
  }, []);
  const visible = !!state?.activity;
  useEffect(() => {
    if (!visible) return;
    let frame = requestAnimationFrame(() => { frame = requestAnimationFrame(() => window.computerActivity?.ready()); });
    return () => cancelAnimationFrame(frame);
  }, [visible]);
  if (!state) return null;
  return <ComputerActivityCapsule state={state} onStop={() => window.computerActivity!.stop()} onHover={(inside) => window.computerActivity?.hover(inside)} />;
}
