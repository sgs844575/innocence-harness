import { useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { Select } from "../ui/Select";
import { HOOK_EVENT_IDS, type HookDefinition } from "../../../../shared/hookSettingsIpc";

const fieldClass = "w-full rounded-lg border border-(--color-border) bg-(--color-background) px-3 py-2 text-(--color-foreground) outline-none focus:border-(--color-accent) disabled:opacity-60";
const MAX_TIMEOUT_MS = 30_000;

export function HookCreateDialog({ label, onSubmit, onClose }: { label: (key: string) => string; onSubmit: (hook: HookDefinition) => Promise<void>; onClose: () => void }): React.JSX.Element {
  const [event, setEvent] = useState<string>(HOOK_EVENT_IDS[0]);
  const [command, setCommand] = useState("");
  const [match, setMatch] = useState("");
  const [timeout, setTimeoutText] = useState("");
  const [condition, setCondition] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const lock = useRef(false);
  const save = async () => {
    if (lock.current) return;
    const timeoutMs = timeout.trim() === "" ? undefined : Number(timeout.trim());
    if (!command.trim() || (timeoutMs !== undefined && (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > MAX_TIMEOUT_MS))) {
      setError(label("invalidForm"));
      return;
    }
    lock.current = true; setBusy(true); setError("");
    const hook: HookDefinition = {
      event: event as HookDefinition["event"],
      command: command.trim(),
      ...(match.trim() ? { match: match.trim() } : {}),
      ...(timeoutMs !== undefined ? { timeoutMs } : {}),
      ...(condition.trim() ? { condition: condition.trim() } : {}),
    };
    try { await onSubmit(hook); onClose(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { lock.current = false; setBusy(false); }
  };
  return <Dialog.Root open onOpenChange={(open) => { if (!open && !busy) onClose(); }}><Dialog.Portal><Dialog.Overlay className="fixed inset-0 z-50 bg-(--color-markdown-table-backdrop)" /><Dialog.Content className="modal-in fixed top-1/2 left-1/2 z-50 flex max-h-[90vh] w-[min(672px,92vw)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-(--radius-pop) border border-(--color-border) bg-(--color-popup) p-5 shadow-(--shadow-pop)"><div className="flex items-center justify-between"><Dialog.Title className="font-medium">{label("createTitle")}</Dialog.Title><Dialog.Close disabled={busy} aria-label={label("close")} className="rounded p-1 hover:bg-(--color-hover)"><X size={16} /></Dialog.Close></div><Dialog.Description className="mt-2 text-[12px] text-(--color-muted)">{label("createHint")}</Dialog.Description>
    <form className="scrollbar-thin mt-4 space-y-4 overflow-y-auto" onSubmit={(e) => { e.preventDefault(); void save(); }}>
      <label className="block space-y-1"><span className="text-(--color-muted)">{label("fieldEvent")}</span><Select fullWidth disabled={busy} ariaLabel={label("fieldEvent")} value={event} options={HOOK_EVENT_IDS.map((id) => ({ value: id, label: id }))} onChange={setEvent} /></label>
      <label className="block space-y-1"><span className="text-(--color-muted)">{label("fieldCommand")}</span><input required disabled={busy} className={`${fieldClass} font-mono`} value={command} onChange={(e) => setCommand(e.target.value)} /></label>
      <label className="block space-y-1"><span className="text-(--color-muted)">{label("fieldMatch")}</span><input disabled={busy} className={`${fieldClass} font-mono`} value={match} onChange={(e) => setMatch(e.target.value)} /></label>
      <label className="block space-y-1"><span className="text-(--color-muted)">{label("fieldTimeout")}</span><input disabled={busy} inputMode="numeric" className={`${fieldClass} font-mono`} value={timeout} onChange={(e) => setTimeoutText(e.target.value.replace(/[^0-9]/g, ""))} /></label>
      <label className="block space-y-1"><span className="text-(--color-muted)">{label("fieldCondition")}</span><input disabled={busy} className={fieldClass} value={condition} onChange={(e) => setCondition(e.target.value)} /></label>
      {error && <p role="alert" className="text-(--color-tool-err)">{error}</p>}
      <div className="flex justify-end gap-2"><button type="button" disabled={busy} onClick={onClose} className="rounded-lg px-3 py-2 hover:bg-(--color-hover)">{label("cancel")}</button><button type="submit" disabled={busy} className="rounded-lg bg-(--color-brand) px-4 py-2 text-(--color-inverse) disabled:opacity-45">{label(busy ? "loading" : "submit")}</button></div>
    </form>
  </Dialog.Content></Dialog.Portal></Dialog.Root>;
}
