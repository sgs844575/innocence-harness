import { Search, FileCode2, ListTodo, Command } from "lucide-react";
import { useMemo, useState } from "react";
import { Dialog, DialogContent, DialogOverlay, DialogPortal, DialogTitle } from "./ui/Dialog";

export interface GlobalSearchSession {
  id: string;
  title: string;
}

export interface GlobalSearchAction {
  id: string;
  label: string;
  onSelect: () => void;
}

export function GlobalSearchDialog({
  open,
  onOpenChange,
  sessions,
  files,
  actions,
  onSelectSession,
  onSelectFile,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sessions: readonly GlobalSearchSession[];
  files: readonly string[];
  actions: readonly GlobalSearchAction[];
  onSelectSession: (id: string) => void;
  onSelectFile?: (path: string) => void;
}): React.JSX.Element {
  const [query, setQuery] = useState("");
  const normalized = query.trim().toLowerCase();
  const matchingSessions = useMemo(
    () => sessions.filter((session) => session.title.toLowerCase().includes(normalized)),
    [sessions, normalized],
  );
  const matchingFiles = useMemo(
    () => files.filter((file) => file.toLowerCase().includes(normalized)).slice(0, 50),
    [files, normalized],
  );
  const matchingActions = useMemo(
    () => actions.filter((action) => action.label.toLowerCase().includes(normalized)),
    [actions, normalized],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPortal>
        <DialogOverlay className="fixed inset-0 z-50 bg-black/35" />
        <DialogContent aria-label="全局搜索" className="fixed left-1/2 top-[18vh] z-50 w-[min(620px,calc(100vw-32px))] -translate-x-1/2 pop-in overflow-hidden rounded-(--radius-pop) border border-(--color-app-border) bg-(--color-app-raised) shadow-(--shadow-pop)">
          <DialogTitle className="sr-only">全局搜索</DialogTitle>
          <div className="flex items-center gap-2 border-b border-(--color-app-hairline) px-4 py-3">
            <Search size={16} className="text-(--color-app-muted)" />
            <input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索任务、操作或文件…"
              aria-label="搜索任务、操作或文件"
              className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-(--color-app-muted)"
            />
            <kbd className="rounded border border-(--color-app-border) px-1.5 py-0.5 text-(--color-app-muted)">Esc</kbd>
          </div>
          <div className="max-h-[min(65vh,480px)] overflow-y-auto p-2">
            <SearchGroup icon={<Command size={13} />} label="操作" empty={matchingActions.length === 0}>
              {matchingActions.map((action) => (
                <button key={action.id} type="button" className="flex w-full items-center rounded-lg px-3 py-2 text-left hover:bg-(--color-app-bubble)" onClick={() => { action.onSelect(); onOpenChange(false); }}>
                  {action.label}
                </button>
              ))}
            </SearchGroup>
            <SearchGroup icon={<ListTodo size={13} />} label="任务" empty={matchingSessions.length === 0}>
              {matchingSessions.map((session) => (
                <button key={session.id} type="button" className="flex w-full items-center rounded-lg px-3 py-2 text-left hover:bg-(--color-app-bubble)" onClick={() => { onSelectSession(session.id); onOpenChange(false); }}>
                  {session.title}
                </button>
              ))}
            </SearchGroup>
            <SearchGroup icon={<FileCode2 size={13} />} label="文件" empty={matchingFiles.length === 0}>
              {matchingFiles.map((file) => (
                <button key={file} type="button" disabled={!onSelectFile} className="flex w-full items-center rounded-lg px-3 py-2 text-left font-mono hover:bg-(--color-app-bubble) disabled:cursor-not-allowed disabled:opacity-50" onClick={() => { onSelectFile?.(file); onOpenChange(false); }}>
                  {file}
                </button>
              ))}
            </SearchGroup>
            {matchingActions.length === 0 && matchingSessions.length === 0 && matchingFiles.length === 0 && (
              <p className="px-3 py-6 text-center text-(--color-app-muted)">没有匹配结果</p>
            )}
          </div>
        </DialogContent>
      </DialogPortal>
    </Dialog>
  );
}

function SearchGroup({ icon, label, empty, children }: { icon: React.ReactNode; label: string; empty: boolean; children: React.ReactNode }): React.JSX.Element | null {
  if (empty) return null;
  return (
    <section className="mb-2 last:mb-0">
      <h2 className="flex items-center gap-1.5 px-3 py-1.5 font-semibold uppercase tracking-wide text-(--color-app-muted)">{icon}{label}</h2>
      {children}
    </section>
  );
}
