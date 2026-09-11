import { useRef, useState } from "react";
import { Brain, Folder, RefreshCw, Search } from "lucide-react";
import type { HarnessSettings } from "../../../../shared/ipc";
import type { HarnessSettingsPatch } from "../../../../shared/settingsPatch";
import type { MemoryIpcApi } from "../../../../shared/memoryIpc";
import type { EditorIpcApi } from "../../../../shared/editorIpc";
import { useMemoryFiles } from "../../state/useMemoryFiles";
import { Select } from "../ui/Select";
import { Switch } from "../ui/Switch";
import { SettingsRow } from "./rows";
import { MemoryFileRow } from "./MemoryFileRow";
import { MemoryPreview } from "./MemoryPreview";

interface Props {
  t: (key: string) => string;
  settings: HarnessSettings | null;
  api?: MemoryIpcApi & Partial<EditorIpcApi>;
  initialWorkspace?: string;
  onPatchSettings: (patch: HarnessSettingsPatch) => void | Promise<void>;
}

export function MemoryPanel({ t, settings, api, initialWorkspace, onPatchSettings }: Props): React.JSX.Element {
  const editorApi = api?.editorsList && api.editorsSelect && api.editorOpenWorkspace ? api as MemoryIpcApi & EditorIpcApi : undefined;
  const state = useMemoryFiles(api, initialWorkspace ?? settings?.workspaceRoot);
  const [query, setQuery] = useState("");
  const [preview, setPreview] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const locked = useRef(false);
  const reportError = (cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause));
  const save = async (enabled: boolean) => {
    if (locked.current) return;
    locked.current = true;
    setSaving(true);
    setError(null);
    try { await onPatchSettings({ pluginToggleChanges: { memory: enabled } }); }
    catch (cause) { reportError(cause); }
    finally { locked.current = false; setSaving(false); }
  };
  const visibleFiles = state.files.filter((file) => file.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  return <div className="mx-auto w-full max-w-[832px]" data-testid="memory-settings">
    <h1 className="mb-7 text-[28px] font-bold text-(--color-foreground-strong)">{t("settings.section.memory")}</h1>
    <div className="overflow-hidden rounded-(--radius-pop) border border-(--color-border) bg-(--color-raised)">
      <SettingsRow title={t("settings.memory.enabled")} desc={t("settings.memory.enabled.desc")}>
        <Switch tone="neutral" checked={settings?.pluginToggles?.memory !== false} disabled={!settings || saving || !api} label={t("settings.memory.enabled")} onChange={(next) => void save(next)} />
      </SettingsRow>
    </div>
    {error && <p role="alert" className="mt-4 break-words text-(--color-tool-err)">{t("settings.memory.failed")} {error}</p>}
    <div className="mt-6 mb-4 flex flex-wrap items-center gap-3">
      <Select pill icon={<Folder size={15} strokeWidth={1.4} />} popupLabel={t("settings.memory.workspace")} ariaLabel={t("settings.memory.workspace")} value={state.target ?? "__global__"} options={[
        ...state.workspaces.map(({ root, name }) => ({ value: root, label: name })),
        { value: "__global__", label: t("settings.memory.global") },
      ]} onChange={(value) => { state.setTarget(value === "__global__" ? null : value); setPreview(null); setError(null); }} />
      <span aria-live="polite" className="border-l border-(--color-border) pl-3 text-[12px] text-(--color-muted)">{state.loading ? t("settings.memory.loading") : t("settings.memory.count").replace("{count}", String(state.files.length))}</span>
      <label className="ml-auto flex h-9 w-64 max-w-full items-center gap-2 rounded-(--radius-pop) border border-(--color-border) bg-(--color-raised) px-3 focus-within:border-(--color-accent)"><Search size={15} strokeWidth={1.4} className="shrink-0 text-(--color-muted)" aria-hidden /><input type="search" aria-label={t("settings.memory.search")} placeholder={t("settings.memory.search")} value={query} onChange={(event) => setQuery(event.target.value)} className="min-w-0 flex-1 bg-transparent text-(--color-foreground) outline-none placeholder:text-(--color-faint)" /></label>
    </div>
    <div className="mb-4 flex items-center justify-between"><h2 className="text-(--color-foreground-strong)">{t("settings.memory.files")}</h2><button type="button" disabled={!api || state.loading} aria-label={t("settings.memory.refresh")} title={t("settings.memory.refresh")} onClick={state.refresh} className="grid size-7 place-items-center rounded-lg border border-(--color-border) text-(--color-muted) hover:bg-(--color-hover) focus-visible:outline-2 focus-visible:outline-(--color-accent) disabled:opacity-45"><RefreshCw size={15} strokeWidth={1.4} aria-hidden /></button></div>
    {state.error && <p role="alert" className="mb-4 break-words text-(--color-tool-err)">{t("settings.memory.failed")} {state.error}</p>}
    <ul aria-label={t("settings.memory.files")} aria-busy={state.loading} className="divide-y divide-(--color-hairline) overflow-hidden rounded-(--radius-pop) bg-(--color-panel)">
      {api && visibleFiles.map((file) => <MemoryFileRow key={`${state.target}:${file.name}`} t={t} file={file} locale={settings?.locale} editorApi={editorApi} onPreview={() => setPreview(file.name)} onOpen={(action) => api.memoryOpenFile(state.target, file.name, action)} onError={reportError} />)}
    </ul>
    {!state.error && !visibleFiles.length && <div role="status" className="rounded-(--radius-pop) border border-dashed border-(--color-border) px-6 py-12 text-center text-(--color-muted)"><Brain size={26} strokeWidth={1.4} className="mx-auto mb-3 text-(--color-faint)" aria-hidden /><p>{!api ? t("settings.memory.unavailable") : state.loading ? t("settings.memory.loading") : query.trim() ? t("settings.memory.noResults") : t("settings.memory.empty")}</p>{api && !state.loading && !query.trim() && <p className="mt-2 text-[12px] text-(--color-faint)">{t("settings.memory.emptyHint")}</p>}</div>}
    {preview && api && <MemoryPreview key={`${state.target}:${preview}`} api={api} target={state.target} name={preview} t={t} onClose={() => setPreview(null)} />}
  </div>;
}
