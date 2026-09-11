import { useRef, useState, type ReactNode } from "react";
import { CodeXml, FolderOpen } from "lucide-react";
import type { EditorIpcApi, EditorWorkspaceTarget, InstalledEditor } from "../../../shared/editorIpc";
import { useExternalEditors } from "../state/useExternalEditors";
import { Select } from "./ui/Select";

function EditorIcon({ editor }: { editor?: InstalledEditor }) {
  if (editor?.icon?.startsWith("data:image/")) return <img src={editor.icon} alt="" className="size-4 object-contain" />;
  return editor?.kind === "fileManager" ? <FolderOpen size={16} strokeWidth={1.4} aria-hidden /> : <CodeXml size={16} strokeWidth={1.4} aria-hidden />;
}

interface Props {
  api?: EditorIpcApi;
  t: (key: string) => string;
  onOpen: () => Promise<void>;
  onError: (error: unknown) => void;
  openLabel: string;
  selectLabel?: string;
  disabled?: boolean;
  disabledReason?: string;
  footer?: ReactNode | ((close: () => void) => ReactNode);
}

export function EditorLauncher({ api, t, onOpen, onError, openLabel, selectLabel, disabled, disabledReason, footer }: Props): React.JSX.Element {
  const state = useExternalEditors(api);
  const [opening, setOpening] = useState(false);
  const locked = useRef(false);
  const selected = state.catalog?.editors.find(({ id }) => id === state.catalog?.selectedId);
  const name = (editor: InstalledEditor) => editor.kind === "fileManager" ? t("editor.fileManager") : editor.kind === "custom" ? t("editor.custom") : editor.name;
  const run = async () => {
    if (locked.current) return;
    locked.current = true;
    setOpening(true);
    try { await onOpen(); } catch (error) { onError(error); }
    finally { locked.current = false; setOpening(false); }
  };
  return <div className="app-no-drag flex shrink-0 rounded-lg border border-(--color-border) bg-(--color-raised)">
    <button type="button" disabled={disabled || opening || state.selecting || (!!api && !selected)} aria-label={openLabel} aria-description={disabled ? disabledReason : undefined} title={disabled ? disabledReason : selected ? `${openLabel} · ${name(selected)}` : openLabel} onClick={() => void run()} className="grid h-7 w-8 place-items-center rounded-l-lg text-(--color-foreground) hover:bg-(--color-hover) focus-visible:outline-2 focus-visible:outline-(--color-accent) disabled:opacity-45">
      <EditorIcon editor={selected} />
    </button>
    <Select iconOnly value={state.catalog?.selectedId ?? ""} ariaLabel={selectLabel ?? t("editor.choose")} disabled={opening || state.selecting} options={(state.catalog?.editors ?? []).map((editor) => ({ value: editor.id, label: name(editor), icon: <EditorIcon editor={editor} /> }))} onOpenChange={(open) => { if (open) void state.refresh(true); }} onChange={(id) => { void state.select(id).catch(onError); }} footer={(close) => <>
      {state.loading && <p role="status" className="px-2.5 py-2 text-(--color-muted)">{t("editor.detecting")}</p>}
      {state.error && <p role="alert" className="max-w-64 break-words px-2.5 py-2 text-(--color-tool-err)">{t("editor.failed")} {state.error}</p>}
      {!state.loading && state.catalog?.editors.every((editor) => editor.kind === "fileManager") && <p className="max-w-64 px-2.5 py-2 text-(--color-muted)">{t("editor.empty")}</p>}
      {typeof footer === "function" ? footer(close) : footer}
    </>} />
  </div>;
}

export function WorkspaceEditorLauncher({ api, t, target, onError }: {
  api?: EditorIpcApi; t: Props["t"]; target?: EditorWorkspaceTarget; onError: Props["onError"];
}): React.JSX.Element {
  return <div className="mr-2"><EditorLauncher api={api} t={t} disabled={!api || !target} disabledReason={t("editor.noWorkspace")} openLabel={t("titlebar.externalEditor")} onError={onError} onOpen={async () => { if (api && target) await api.editorOpenWorkspace(target); }} /></div>;
}
