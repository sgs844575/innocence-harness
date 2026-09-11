import type { McpServerEntry } from "../../../../shared/mcpSettingsIpc";
import { Select } from "../ui/Select";

export const mcpField = "h-8 w-full rounded-lg border border-(--color-border) bg-(--color-raised) px-3 text-(--color-foreground) outline-none focus:border-(--color-accent) placeholder:text-(--color-faint) disabled:opacity-60";
export function McpFields({ name, entry, busy, create, args, variables, headers, onName, onEntry, onArgs, onVariables, onHeaders, t }: {
  name: string; entry: McpServerEntry; busy: boolean; create: boolean; args: string; variables: string; headers: string;
  onName: (value: string) => void; onEntry: (value: McpServerEntry) => void;
  onArgs: (value: string) => void; onVariables: (value: string) => void; onHeaders: (value: string) => void;
  t: (key: string) => string;
}): React.JSX.Element {
  const label = (key: string) => t(`settings.mcp.${key}`);
  const type = entry.type ?? (entry.url ? /^wss?:/.test(entry.url) ? "ws" : "http" : "stdio");
  const remote = type !== "stdio";
  const fieldLabel = "block space-y-1 text-(--color-muted)";
  return <div className="space-y-3">
    <label className={`${fieldLabel} w-48 max-w-full`}><span>{label("name")}</span><input required disabled={busy || !create} maxLength={128} placeholder="my-mcp-server" className={mcpField} value={name} onChange={(e) => onName(e.target.value)} /></label>
    <div className="w-48 max-w-full space-y-1"><span className="text-(--color-muted)">{label("type")}</span><Select fullWidth disabled={busy} ariaLabel={label("type")} value={type} options={["stdio", "http", "sse", "ws"].map((value) => ({ value, label: label(value) }))} onChange={(value) => {
      const { command, args: _args, env: _env, cwd: _cwd, url, headers: _headers, oauth: _oauth, protocolVersion: _protocol, ...common } = entry;
      onEntry(value === "stdio" ? { ...common, type: "stdio", command: command ?? "", args: [] } : { ...common, type: value as "http" | "sse" | "ws", url: url ?? "" });
    }} /></div>
    <label className={`${fieldLabel} w-48 max-w-full`}><span>{label("timeout")}</span><input className={mcpField} type="number" min={1} max={2147483647} disabled={busy} placeholder="30000" value={entry.timeout ?? ""} onChange={(e) => onEntry({ ...entry, timeout: e.target.value ? Number(e.target.value) : undefined })} /></label>
    <div className="w-48 max-w-full space-y-1"><span className="text-(--color-muted)">{label("protocol")}</span><Select fullWidth disabled={busy || type === "http" || type === "sse"} ariaLabel={label("protocol")} value={entry.protocolVersion ?? "auto"} options={[{ value: "auto", label: label("auto") }, ...((type === "http" || type === "sse") ? [] : ["2025-06-18", "2025-03-26", "2024-11-05"].map((value) => ({ value, label: value })))]} onChange={(value) => onEntry({ ...entry, protocolVersion: value === "auto" ? undefined : value })} /></div>
    <label className={fieldLabel}><span>{label(remote ? "url" : "command")}</span><input required disabled={busy} className={mcpField} placeholder={remote ? "https://example.test/mcp" : "runner"} value={remote ? entry.url ?? "" : entry.command ?? ""} onChange={(e) => onEntry({ ...entry, [remote ? "url" : "command"]: e.target.value })} /></label>
    {!remote && <label className={fieldLabel}><span>{label("args")}</span><input disabled={busy} className={`${mcpField} font-mono`} placeholder='["--option", "value"]' value={args} onChange={(e) => onArgs(e.target.value)} /></label>}
    <details className="text-(--color-muted)"><summary className="py-1">{label(remote ? "headers" : "env")}</summary><label className="mt-2 block"><span className="sr-only">{label(remote ? "headers" : "env")}</span><textarea rows={4} disabled={busy} spellCheck={false} className={`${mcpField} h-auto py-2 font-mono`} value={remote ? headers : variables} onChange={(e) => remote ? onHeaders(e.target.value) : onVariables(e.target.value)} /></label></details>
  </div>;
}
