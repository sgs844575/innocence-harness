// 「进程监视器」对话框：app:metrics 快照表格（内存降序），打开期间 2s 轮询。
// Esc/遮罩/X 关闭（AddModelDialog 同范式）。
import { useEffect, useState } from "react";
import { X } from "lucide-react";
import type { AppProcessMetric } from "../../../shared/ipc";
import { api, hasBridge } from "../lib/ipc";

const POLL_MS = 2000;

export function ProcessMonitorDialog({
  t,
  onClose,
}: {
  t: (key: string) => string;
  onClose: () => void;
}): React.JSX.Element {
  const [rows, setRows] = useState<AppProcessMetric[]>([]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  useEffect(() => {
    if (!hasBridge()) return;
    let alive = true;
    const load = () => {
      void api
        .getAppMetrics()
        .then((metrics) => {
          if (alive) setRows(metrics);
        })
        .catch(() => undefined);
    };
    load();
    const timer = setInterval(load, POLL_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  const sorted = [...rows].sort((a, b) => b.memoryMB - a.memoryMB);
  const cell = "px-2 py-1.5";

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center"
      role="dialog"
      aria-label={t("titlebar.appMenu.processMonitor")}
    >
      <button
        type="button"
        aria-label={t("settings.dialog.cancel")}
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-black/25"
      />
      <div
        data-state="open"
        className="modal-in relative w-[440px] rounded-(--radius-pop) border border-(--color-border) bg-(--color-popup) shadow-(--shadow-pop)"
      >
        <div className="flex items-center border-b border-(--color-hairline) px-4 py-2.5">
          <span className="font-bold text-(--color-foreground-strong)">{t("titlebar.appMenu.processMonitor")}</span>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("settings.dialog.cancel")}
            title={t("settings.dialog.cancel")}
            className="ml-auto grid size-7 place-items-center rounded-md text-(--color-muted) hover:bg-(--color-hover) hover:text-(--color-foreground)"
          >
            <X size={14} strokeWidth={1.5} />
          </button>
        </div>
        <div className="scrollbar-thin max-h-[320px] overflow-y-auto p-2">
          <table className="w-full text-left">
            <thead>
              <tr className="text-(--color-faint)">
                <th className={`${cell} font-normal`}>{t("procmon.col.process")}</th>
                <th className={`${cell} font-normal`}>PID</th>
                <th className={`${cell} font-normal`}>CPU %</th>
                <th className={`${cell} text-right font-normal`}>{t("procmon.col.memory")}</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((row) => (
                <tr key={row.pid} className="border-t border-(--color-hairline) text-(--color-foreground)">
                  <td className={cell}>{row.type}</td>
                  <td className={`${cell} font-mono`}>{row.pid}</td>
                  <td className={`${cell} font-mono`}>{row.cpuPercent}</td>
                  <td className={`${cell} text-right font-mono`}>{row.memoryMB}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
