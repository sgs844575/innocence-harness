// 工作台页：列表（卡片栅格 + 虚线空态）与运行（顶栏 + 沙箱 iframe）两态。
// 运行态经 workbench:changed 事件热刷新（watch 在进入时注册、离开时释放，
// 版本号进 iframe src 查询串触发重载）。「在对话中编辑」/创建流转经
// onOpenChat 绑定工作台目录开新会话（宿主 App 组装）。
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Plus, RefreshCw, SquarePen, Trash2 } from "lucide-react";
import type { WorkbenchApi, WorkbenchMeta } from "../../../../shared/workbenchIpc";
import { relativeTime } from "../../lib/time";
import { WorkbenchCreateDialog } from "./WorkbenchDialogs";

/** LLM-facing bootstrap prompt（英文，规则 16）：仅创建时带需求描述才注入。 */
export function workbenchBootstrapPrompt(description: string): string {
  return `Build a personal workbench app in this directory: a fully self-contained static web app with index.html as the entry point — plain HTML/CSS/JavaScript only, no build step, no external network resources. Requirement: ${description}`;
}

const iconButton = "rounded-lg border border-(--color-border) p-1.5 text-(--color-muted) hover:bg-(--color-hover) focus-visible:outline-2 focus-visible:outline-(--color-accent) disabled:opacity-45";

export function WorkbenchView({ t, api, onOpenChat, onBack }: {
  t: (key: string) => string;
  api?: WorkbenchApi;
  onOpenChat: (dir: string, bootstrapPrompt?: string) => void;
  onBack: () => void;
}): React.JSX.Element {
  const [items, setItems] = useState<WorkbenchMeta[]>([]);
  const [openedId, setOpenedId] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [tick, setTick] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const lock = useRef(false);
  const label = (key: string) => t(`workbench.${key}`);
  useEffect(() => {
    let current = true;
    setLoading(true); setError("");
    if (!api) { setLoading(false); return; }
    void api.workbenchList().then((rows) => { if (current) setItems(rows); }).catch((e) => { if (current) setError(String(e)); }).finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [api, tick]);
  // 运行态热刷新：监听目录 → main 去抖广播 workbench:changed → 版本号 +1。
  useEffect(() => {
    if (!api || openedId === null) return;
    void api.workbenchWatch(openedId).catch(() => undefined);
    const off = api.onWorkbenchChanged((payload) => { if (payload.id === openedId) setVersion((v) => v + 1); });
    return () => { off(); void api.workbenchUnwatch(openedId).catch(() => undefined); };
  }, [api, openedId]);
  const remove = async (id: string) => {
    if (lock.current || !api) return;
    lock.current = true; setBusy(true); setError("");
    try { await api.workbenchRemove(id); setTick((n) => n + 1); setDeleting(null); }
    catch (e) { setError(String(e)); }
    finally { lock.current = false; setBusy(false); }
  };
  const opened = items.find((item) => item.id === openedId) ?? null;
  if (opened) {
    return <div className="flex h-full flex-col" data-testid="workbench-run">
      <div className="flex items-center gap-3 border-b border-(--color-hairline) px-5 py-3">
        <button type="button" aria-label={label("back")} title={label("back")} onClick={() => setOpenedId(null)} className="grid size-7 place-items-center rounded-md text-(--color-muted) hover:bg-(--color-hover) hover:text-(--color-foreground)"><ArrowLeft size={15} /></button>
        <h1 className="min-w-0 flex-1 truncate font-bold text-(--color-foreground-strong)">{opened.name}</h1>
        <button type="button" onClick={() => onOpenChat(opened.dir)} className="flex items-center gap-1 rounded-lg border border-(--color-border) px-2.5 py-1 text-(--color-muted) hover:bg-(--color-hover) focus-visible:outline-2 focus-visible:outline-(--color-accent)"><SquarePen size={14} />{label("editChat")}</button>
        <button type="button" aria-label={label("refresh")} title={label("refresh")} onClick={() => setVersion((v) => v + 1)} className={iconButton}><RefreshCw size={15} /></button>
      </div>
      <iframe sandbox="allow-scripts" title={opened.name} src={`innocenceharness-workbench://${opened.id}/index.html?v=${version}`} className="min-h-0 w-full flex-1 border-0 bg-(--color-background)" />
    </div>;
  }
  return <div className="scrollbar-thin h-full overflow-y-auto" data-testid="workbench-view">
    <div className="mx-auto w-full max-w-[832px] p-6">
      <div className="mb-7 flex items-center gap-3">
        <button type="button" aria-label={label("back")} title={label("back")} onClick={onBack} className="grid size-7 place-items-center rounded-md text-(--color-muted) hover:bg-(--color-hover) hover:text-(--color-foreground)"><ArrowLeft size={15} /></button>
        <h1 className="text-[22px] font-bold text-(--color-foreground-strong)">{t("workbench.title")}</h1>
        <div className="ml-auto flex items-center gap-2">
          <button type="button" disabled={!api || loading || busy} aria-label={label("refresh")} title={label("refresh")} onClick={() => setTick((n) => n + 1)} className={iconButton}><RefreshCw size={15} /></button>
          <button type="button" disabled={!api || busy} onClick={() => setCreating(true)} className="flex items-center gap-1 rounded-lg bg-(--color-brand) px-3 py-1 text-(--color-inverse) disabled:opacity-45"><Plus size={15} />{label("create")}</button>
        </div>
      </div>
      {error && <p role="alert" className="mb-4 text-(--color-tool-err)">{error}</p>}
      {api && !loading && items.length === 0
        ? <div className="rounded-(--radius-pop) border border-dashed border-(--color-border) px-4 py-12 text-center">
          <p className="text-(--color-foreground-strong)">{label("empty")}</p>
          <p className="mt-1 text-[12px] text-(--color-muted)">{label("emptyHint")}</p>
          <button type="button" disabled={busy} onClick={() => setCreating(true)} className="mx-auto mt-4 flex items-center gap-1 rounded-lg bg-(--color-brand) px-3 py-1.5 text-(--color-inverse) disabled:opacity-45"><Plus size={15} />{label("create")}</button>
        </div>
        : items.length === 0 && <p role="status" className="py-12 text-center text-(--color-muted)">{label(!api ? "unavailable" : "loading")}</p>}
      {items.length > 0 && <ul aria-busy={loading || busy} className="grid gap-3 sm:grid-cols-2">{items.map((item) => <li key={item.id} className="rounded-(--radius-pop) border border-(--color-border) bg-(--color-raised) p-4">
        <p title={item.name} className="truncate font-medium text-(--color-foreground-strong)">{item.name}</p>
        <p className="mt-1 text-[12px] text-(--color-muted)">{relativeTime(Date.parse(item.updatedAt))}</p>
        <div className="mt-3 flex items-center gap-2">
          <button type="button" onClick={() => { setVersion(0); setOpenedId(item.id); }} className="rounded-lg bg-(--color-brand) px-3 py-1 text-(--color-inverse) focus-visible:outline-2 focus-visible:outline-(--color-accent)">{label("open")}</button>
          {deleting === item.id
            ? <><button type="button" disabled={busy} className={iconButton} onClick={() => void remove(item.id)}>{label("confirm")}</button><button type="button" disabled={busy} className={iconButton} onClick={() => setDeleting(null)}>{label("cancel")}</button></> :
            <button type="button" disabled={busy} aria-label={`${label("delete")} ${item.name}`} title={`${label("delete")} ${item.name}`} onClick={() => setDeleting(item.id)} className="rounded p-1 text-(--color-muted) hover:bg-(--color-hover) focus-visible:outline-2 focus-visible:outline-(--color-accent)"><Trash2 size={14} /></button>}
        </div>
      </li>)}</ul>}
    </div>
    {creating && api && <WorkbenchCreateDialog label={label} onSubmit={async (name, description) => {
      const meta = await api.workbenchCreate(name);
      onOpenChat(meta.dir, description ? workbenchBootstrapPrompt(description) : undefined);
    }} onClose={() => { setCreating(false); setTick((n) => n + 1); }} />}
  </div>;
}
