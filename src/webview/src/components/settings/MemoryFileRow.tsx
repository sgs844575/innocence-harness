import { useState } from "react";
import { Copy, ExternalLink, FileCode2, FolderOpen } from "lucide-react";
import type { MemoryFileInfo, MemoryOpenAction } from "../../../../shared/memoryIpc";
import type { EditorIpcApi } from "../../../../shared/editorIpc";
import { EditorLauncher } from "../EditorLauncher";

interface Props {
  t: (key: string) => string;
  file: MemoryFileInfo;
  locale?: string;
  onPreview: () => void;
  onOpen: (action: MemoryOpenAction) => Promise<void>;
  onError: (error: unknown) => void;
  editorApi?: EditorIpcApi;
}

export function MemoryFileRow({ t, file, locale, onPreview, onOpen, onError, editorApi }: Props): React.JSX.Element {
  const [busy, setBusy] = useState(false);
  const run = async (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    try { await action(); } catch (error) { onError(error); } finally { setBusy(false); }
  };
  const actions = [
    { label: "settings.memory.openDefault", icon: ExternalLink, run: () => onOpen("default") },
    { label: "settings.memory.reveal", icon: FolderOpen, run: () => onOpen("reveal") },
    { label: "settings.memory.copyPath", icon: Copy, run: () => navigator.clipboard.writeText(file.path) },
  ];
  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <button type="button" onClick={onPreview} aria-label={`${t("settings.memory.preview")} ${file.name}`} className="flex min-w-0 flex-1 items-center gap-3 rounded-md text-left focus-visible:outline-2 focus-visible:outline-(--color-accent)" title={file.path}>
        <span className="grid size-9 shrink-0 place-items-center rounded-(--radius-pop) bg-(--color-background) text-(--color-accent)"><FileCode2 size={18} strokeWidth={1.4} aria-hidden /></span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-(--color-foreground-strong)">{file.name}</span>
          <time dateTime={new Date(file.updatedAt).toISOString()} className="mt-0.5 block text-[12px] text-(--color-muted)">
            {new Date(file.updatedAt).toLocaleString(locale || undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
          </time>
        </span>
      </button>
      <EditorLauncher api={editorApi} t={t} disabled={busy} openLabel={`${t("settings.memory.openEditor")} ${file.name}`} selectLabel={`${t("settings.memory.actions")} ${file.name}`} onOpen={() => onOpen("editor")} onError={onError} footer={(close) => <>
        <div className="mx-1 my-1 h-px bg-(--color-hairline)" role="separator" />
        {actions.map(({ label, icon: Icon, run: action }) => <button key={label} type="button" disabled={busy} onClick={() => { close(); void run(action); }} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-(--color-foreground) hover:bg-(--color-hover) focus-visible:outline-2 focus-visible:outline-(--color-accent)"><Icon size={15} strokeWidth={1.4} aria-hidden />{t(label)}</button>)}
      </>} />
    </li>
  );
}
