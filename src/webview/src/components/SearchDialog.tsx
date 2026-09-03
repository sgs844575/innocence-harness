// 搜索浮层（Ctrl+K）：会话标题过滤 + 回车/点击跳转。无遮罩，居中靠上。
import { useEffect, useMemo, useRef, useState } from "react";
import { Search } from "lucide-react";
import type { Session } from "../../../shared/ipc";
import { relativeTime } from "../lib/time";

/** 与 app.css `--duration-quick`（模态关闭动画）保持一致。 */
const MODAL_CLOSE_MS = 150;

export interface SearchCommand {
  id: string;
  label: string;
  kbd?: string;
  onSelect: () => void;
}

export function SearchDialog({
  t,
  open,
  sessions,
  commands = [],
  onSelect,
  onClose,
}: {
  t: (key: string) => string;
  open: boolean;
  sessions: Session[];
  /** 「建议」命令组（新建任务/设置等），随输入过滤。 */
  commands?: SearchCommand[];
  onSelect: (id: string) => void;
  onClose: () => void;
}): React.JSX.Element | null {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  // 关闭编排：open 变 false 后以 data-state="closed" 再渲染一个关闭动画周期再卸载。
  const [renderOpen, setRenderOpen] = useState(open);

  useEffect(() => {
    if (open) {
      setRenderOpen(true);
      setQuery("");
      requestAnimationFrame(() => inputRef.current?.focus());
      return;
    }
    if (!renderOpen) return;
    const timer = setTimeout(() => setRenderOpen(false), MODAL_CLOSE_MS);
    return () => clearTimeout(timer);
  }, [open, renderOpen]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q ? sessions.filter((session) => session.title.toLowerCase().includes(q)) : sessions;
    return [...list].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 12);
  }, [sessions, query]);

  const matchedCommands = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? commands.filter((command) => command.label.toLowerCase().includes(q)) : commands;
  }, [commands, query]);

  if (!renderOpen) return null;
  const state = open ? "open" : "closed";
  return (
    <div className="fixed inset-0 z-50 flex justify-center pt-[18vh]" role="dialog" aria-label={t("search.title")}>
      <button
        type="button"
        aria-label={t("sidebar.close")}
        onClick={onClose}
        data-state={state}
        className="modal-in absolute inset-0 cursor-default bg-black/25"
      />
      <div
        data-state={state}
        className="modal-in relative h-fit w-[512px] rounded-(--radius-pop) border border-(--color-border) bg-(--color-popup) shadow-(--shadow-pop)"
      >
        <div className="flex items-center gap-2 border-b border-(--color-hairline) px-3.5 py-2.5">
          <Search size={14} className="shrink-0 text-(--color-muted)" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && matches[0]) {
                onSelect(matches[0].id);
                onClose();
              }
            }}
            placeholder={t("search.placeholder")}
            className="w-full bg-transparent outline-none placeholder:text-(--color-faint)"
          />
        </div>
        <div className="scrollbar-thin max-h-[320px] overflow-y-auto p-1.5">
          {matchedCommands.length > 0 && (
            <div className="px-2.5 pb-1 pt-1.5 font-semibold uppercase tracking-wider text-(--color-muted)/70">
              {t("search.suggestions")}
            </div>
          )}
          <ul>
            {matchedCommands.map((command) => (
              <li key={command.id}>
                <button
                  type="button"
                  onClick={() => {
                    command.onSelect();
                    onClose();
                  }}
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-(--color-foreground) hover:bg-(--color-selected)"
                >
                  <span className="min-w-0 flex-1 truncate">{command.label}</span>
                  {command.kbd && <kbd className="shrink-0 text-(--color-faint)">{command.kbd}</kbd>}
                </button>
              </li>
            ))}
          </ul>
          {matches.length > 0 && matchedCommands.length > 0 && (
            <div className="px-2.5 pb-1 pt-1.5 font-semibold uppercase tracking-wider text-(--color-muted)/70">
              {t("sidebar.projects")}
            </div>
          )}
          <ul>
            {matches.length === 0 && matchedCommands.length === 0 && (
              <li className="px-3 py-4 text-center text-(--color-muted)">{t("search.empty")}</li>
            )}
            {matches.map((session) => (
              <li key={session.id}>
                <button
                  type="button"
                  onClick={() => {
                    onSelect(session.id);
                    onClose();
                  }}
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-(--color-foreground) hover:bg-(--color-selected)"
                >
                  <span className="min-w-0 flex-1 truncate">{session.title}</span>
                  <time className="shrink-0 text-(--color-faint)" dateTime={new Date(session.updatedAt).toISOString()}>
                    {relativeTime(session.updatedAt)}
                  </time>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
