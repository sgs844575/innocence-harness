import { useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { ArrowLeft, Download, X } from "lucide-react";
import type { InstallPreview, PluginCatalogApi, RepositorySource } from "../../../../../shared/pluginCatalogIpc";
import { actionClass, fieldClass, primaryClass, type Translate } from "./styles";
import { pluginComponentLabel } from "./pluginPresentation";

export function InstallDialog({ api, t, market, source, onClose, onChanged }: {
  api: PluginCatalogApi; t: Translate; market: boolean; source?: RepositorySource;
  onClose(): void; onChanged(): void;
}): React.JSX.Element {
  const label = (key: string) => t(`settings.plugins.${key}`);
  const [draft, setDraft] = useState<RepositorySource>(source ?? { url: "", ref: "", path: "" });
  const [preview, setPreview] = useState<InstallPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const lock = useRef(false);
  const run = async (action: () => Promise<void>) => {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError("");
    try { await action(); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { lock.current = false; setBusy(false); }
  };
  const close = () => { if (!busy) void run(async () => { if (preview) await api.pluginDiscard(preview.token); onClose(); }); };
  const submit = () => run(async () => {
    if (market) { await api.pluginMarketAdd(draft); onChanged(); onClose(); }
    else if (!preview) setPreview(await api.pluginPreview(draft));
    else { await api.pluginInstall(preview.token); onChanged(); onClose(); }
  });
  return <Dialog.Root open onOpenChange={(open) => { if (!open) close(); }}><Dialog.Portal>
    <Dialog.Overlay className="fixed inset-0 z-50 bg-(--color-markdown-table-backdrop)" />
    <Dialog.Content className="modal-in fixed top-1/2 left-1/2 z-50 flex max-h-[90vh] w-[min(580px,92vw)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-(--radius-pop) border border-(--color-border) bg-(--color-popup) p-5 shadow-(--shadow-pop)">
      <div className="flex items-center justify-between"><Dialog.Title className="font-semibold text-(--color-foreground-strong)">{label(market ? "addMarket" : preview ? "reviewInstall" : "fromGit")}</Dialog.Title><button disabled={busy} onClick={close} aria-label={label("close")} className={actionClass}><X size={15} /></button></div>
      <Dialog.Description className="mt-2 text-(--color-muted)">{label(market ? "marketHint" : "installHint")}</Dialog.Description>
      <form className="scrollbar-thin mt-5 space-y-4 overflow-y-auto" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        {!preview ? <>
          <label className="block space-y-1.5"><span>{label("repository")}</span><input autoFocus required disabled={busy} value={draft.url} onChange={(e) => setDraft({ ...draft, url: e.target.value })} placeholder="https://git.example.org/team/plugins.git" className={`${fieldClass} font-mono`} /></label>
          <div className="grid grid-cols-2 gap-3">{(["ref", "path"] as const).map((key) => <label key={key} className="block space-y-1.5"><span>{label(key)}</span><input disabled={busy} value={draft[key] ?? ""} onChange={(e) => setDraft({ ...draft, [key]: e.target.value })} placeholder={label(`${key}Placeholder`)} className={`${fieldClass} font-mono`} /></label>)}</div>
        </> : <section className="space-y-3 rounded-(--radius-pop) border border-(--color-border) bg-(--color-background) p-4">
          <div className="flex items-center gap-2"><h2 className="font-semibold text-(--color-foreground-strong)">{preview.title}</h2><span className="text-(--color-muted)">{preview.version}</span></div>
          <p className="text-(--color-muted)">{preview.description}</p>
          <p className="break-all font-mono text-[12px] text-(--color-muted)">{preview.source.url}<br />{preview.source.path} · {preview.commit.slice(0, 12)}</p>
          <p>{label("included")}: {preview.components.map((key) => label(`component.${key}`)).join("、") || label("none")}</p>
          {!!preview.unsupported.length && <p className="text-(--color-tool-warn)">{label("unsupported")}: {preview.unsupported.map((key) => pluginComponentLabel(key, t)).join("、")}</p>}
          {!preview.installable && <p role="status" className="text-(--color-tool-warn)">{label("notInstallable")}</p>}
          {preview.replacing && <p>{label("replaceHint")}</p>}
        </section>}
        {error && <p role="alert" className="break-words text-(--color-tool-err)">{error}</p>}
        {busy && <p role="status" className="text-(--color-muted)">{label(preview ? "installing" : "fetching")}</p>}
        <div className="flex items-center justify-end gap-2">
          {preview && <button type="button" disabled={busy} className={`${actionClass} mr-auto`} onClick={() => void run(async () => { await api.pluginDiscard(preview.token); setPreview(null); })}><ArrowLeft size={14} />{label("back")}</button>}
          <button type="button" disabled={busy} onClick={close} className={actionClass}>{label("cancel")}</button>
          <button disabled={busy || (!!preview && !preview.installable)} className={primaryClass} type="submit"><Download size={14} />{label(market ? "add" : preview ? preview.replacing ? "update" : "install" : "preview")}</button>
        </div>
      </form>
    </Dialog.Content>
  </Dialog.Portal></Dialog.Root>;
}
