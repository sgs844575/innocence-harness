import { useRef, useState } from "react";
import type { McpServerEntry } from "../../../../shared/mcpSettingsIpc";
import { McpFields, mcpField } from "./McpFields";
import { McpScope } from "./McpScope";
import { parseEditorJson } from "./mcpForm";

export function McpEditor({ name, entry, importing, create, root, spaces, t, onSave, onClose, onDelete }: {
  name: string; entry: McpServerEntry; importing?: boolean; create: boolean; root: string | null;
  spaces: { root: string; name: string }[]; t: (key: string) => string;
  onSave: (root: string | null, servers: Record<string, McpServerEntry>) => Promise<void>;
  onClose: () => void; onDelete?: () => Promise<void>;
}): React.JSX.Element {
  const [draftName, setName] = useState(name);
  const [draft, setDraft] = useState(entry);
  const [target, setTarget] = useState(root);
  const [mode, setMode] = useState(importing ? "json" : "form");
  const [text, setText] = useState(JSON.stringify({ [name || "my-mcp-server"]: entry }, null, 2));
  const [args, setArgs] = useState(JSON.stringify(entry.args ?? []));
  const [variables, setVariables] = useState(JSON.stringify(entry.env ?? {}, null, 2));
  const [headers, setHeaders] = useState(JSON.stringify(entry.headers ?? {}, null, 2));
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");
  const lock = useRef(false);
  const label = (key: string) => t(`settings.mcp.${key}`);
  const formEntry = (): McpServerEntry => {
    const remote = draft.type !== "stdio" && !!(draft.type || draft.url);
    return remote ? { ...draft, headers: JSON.parse(headers) } : { ...draft, args: JSON.parse(args), env: JSON.parse(variables) };
  };
  const changeMode = (next: string) => {
    if (next === mode) return;
    try {
      if (next === "json") setText(JSON.stringify({ [draftName || "my-mcp-server"]: formEntry() }, null, 2));
      else {
        const entries = Object.entries(parseEditorJson(text));
        if (entries.length !== 1) throw new Error(label("singleForm"));
        const [id, value] = entries[0];
        if (!create && id !== name) throw new Error(label("sameName"));
        setName(id); setDraft(value); setArgs(JSON.stringify(value.args ?? [])); setVariables(JSON.stringify(value.env ?? {}, null, 2)); setHeaders(JSON.stringify(value.headers ?? {}, null, 2));
      }
      setMode(next); setError("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  };
  const run = async (action: () => Promise<void>) => {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError("");
    try { await action(); onClose(); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { lock.current = false; setBusy(false); }
  };
  return <div className="mx-auto w-full max-w-[832px] pt-4" data-testid="mcp-editor">
    <div className="mb-4 flex items-end justify-between gap-4"><div><h1 className="text-[18px] font-semibold text-(--color-foreground-strong)">{label(create ? "createTitle" : "editTitle")}</h1><p className="mt-1 text-(--color-muted)">{label("editorHint")}</p></div><div className="flex rounded-full bg-(--color-panel) p-0.5" aria-label={label("editorMode")}>{["form", "json"].map((value) => <button key={value} type="button" disabled={busy} aria-pressed={mode === value} onClick={() => changeMode(value)} className={`rounded-full px-3 py-1 focus-visible:outline-2 focus-visible:outline-(--color-accent) ${mode === value ? "bg-(--color-background) text-(--color-foreground-strong)" : "text-(--color-muted)"}`}>{label(value)}</button>)}</div></div>
    <form className="relative rounded-(--radius-pop) border border-(--color-border) p-4" onSubmit={(e) => { e.preventDefault(); void run(async () => {
      const servers = mode === "json" ? parseEditorJson(text) : { [draftName]: formEntry() };
      if (!create && (Object.keys(servers).length !== 1 || !Object.hasOwn(servers, name))) throw new Error(label("sameName"));
      await onSave(target, servers);
    }); }}>
      <div className="mb-4 flex items-center justify-end gap-2 sm:absolute sm:top-4 sm:right-4"><span className="text-(--color-muted)">{label("scope")}</span><McpScope value={target} spaces={spaces} disabled={busy || !create} onChange={setTarget} t={t} /></div>
      {mode === "form" ? <McpFields name={draftName} entry={draft} busy={busy} create={create} args={args} variables={variables} headers={headers} onName={setName} onEntry={setDraft} onArgs={setArgs} onVariables={setVariables} onHeaders={setHeaders} t={t} /> : <label className="block space-y-2 sm:mt-10"><span className="text-(--color-muted)">{label("fullConfig")}</span><textarea required rows={10} disabled={busy} spellCheck={false} className={`${mcpField} h-auto py-2 font-mono leading-6`} value={text} onChange={(e) => setText(e.target.value)} /><p className="text-(--color-muted)">{label("jsonHint")}</p></label>}
      {error && <p role="alert" className="mt-4 break-words text-(--color-tool-err)">{error}</p>}
      <div className="mt-5 flex items-center gap-3">
        {onDelete && <button type="button" disabled={busy} className="mr-auto rounded-lg px-2 py-1 text-(--color-tool-err) hover:bg-(--color-hover)" onClick={() => deleting ? void run(onDelete) : setDeleting(true)}>{label(deleting ? "confirmDelete" : "delete")}</button>}
        <button type="submit" disabled={busy} className="ml-auto rounded-lg bg-(--color-brand) px-3 py-1.5 text-(--color-inverse) disabled:opacity-45">{label(busy ? "saving" : "save")}</button>
        <button type="button" disabled={busy} onClick={onClose} className="rounded-lg px-3 py-1.5 hover:bg-(--color-hover)">{label("cancel")}</button>
      </div>
    </form>
  </div>;
}
