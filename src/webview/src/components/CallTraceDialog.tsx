import { X } from "lucide-react";
import type { ChatMessage } from "../../../shared/ipc";

interface TraceRow {
  id: string;
  kind: "turn" | "tool";
  title: string;
  detail: string;
  payload?: string;
  at: number;
}

function serializeTracePayload(value: unknown): string {
  try {
    const serialized = JSON.stringify(value, null, 2);
    return serialized === undefined ? String(value) : serialized;
  } catch {
    return String(value);
  }
}

export function callTraceRows(messages: readonly ChatMessage[]): TraceRow[] {
  const rows: TraceRow[] = [];
  for (const message of messages) {
    if (message.role === "assistant") {
      const completion = message.completion;
      rows.push({
        id: `${message.id}:turn`,
        kind: "turn",
        title: completion?.modelId || "—",
        detail: completion
          ? `${completion.finishReason} · ${completion.usage?.totalTokens ?? 0} tokens`
          : message.streaming ? "running" : "incomplete",
        at: message.createdAt,
      });
    }
    for (const part of message.parts) {
      if (part.type !== "toolCall") continue;
      const result = messages
        .flatMap((candidate) => candidate.parts)
        .find((candidate) => candidate.type === "toolResult" && candidate.toolCallId === part.id);
      rows.push({
        id: `${message.id}:${part.id}`,
        kind: "tool",
        title: part.toolName,
        detail: result?.type === "toolResult"
          ? `${result.isError ? "error" : "completed"}${result.durationMs === undefined ? "" : ` · ${result.durationMs} ms`}`
          : "pending",
        payload: serializeTracePayload({
          args: part.args,
          ...(result?.type === "toolResult"
            ? { result: { content: result.content, isError: result.isError === true, durationMs: result.durationMs } }
            : {}),
        }),
        at: message.createdAt,
      });
    }
  }
  return rows;
}

export function CallTraceDialog({
  t,
  messages,
  onClose,
}: {
  t: (key: string) => string;
  messages: readonly ChatMessage[];
  onClose: () => void;
}): React.JSX.Element {
  const rows = callTraceRows(messages);
  return (
    <div className="fixed inset-0 z-[100] grid place-items-center bg-(--color-background)/75 p-6 backdrop-blur-sm" role="presentation" onMouseDown={onClose}>
      <section
        role="dialog"
        aria-modal="true"
        aria-label={t("trace.title")}
        className="modal-in flex max-h-[76vh] w-full max-w-2xl flex-col overflow-hidden rounded-(--radius-pop) border border-(--color-border) bg-(--color-popup) shadow-(--shadow-card)"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="flex h-12 shrink-0 items-center border-b border-(--color-hairline) px-4">
          <div>
            <h2 className="font-bold text-(--color-foreground-strong)">{t("trace.title")}</h2>
            <p className="text-[12px] text-(--color-muted)">{t("trace.desc")}</p>
          </div>
          <button type="button" className="ml-auto grid size-7 place-items-center rounded-md text-(--color-muted) hover:bg-(--color-hover)" onClick={onClose} aria-label={t("dock.close")}>
            <X size={15} />
          </button>
        </header>
        <div className="min-h-0 overflow-auto p-3">
          {rows.length === 0 ? (
            <p className="px-2 py-8 text-center text-(--color-muted)">{t("trace.empty")}</p>
          ) : (
            <ol className="space-y-1">
              {rows.map((row) => (
                <li key={row.id} className="rounded-lg px-3 py-2 hover:bg-(--color-hover)">
                  <div className="flex items-center gap-3">
                    <span className={`size-1.5 shrink-0 rounded-full ${row.kind === "tool" ? "bg-(--color-accent)" : "bg-(--color-muted)"}`} />
                    <span className="min-w-0 flex-1 truncate font-mono text-[13px] text-(--color-foreground)">{row.title}</span>
                    <span className="shrink-0 text-[12px] text-(--color-muted)">{row.detail}</span>
                    <time className="w-16 shrink-0 text-right text-[12px] tabular-nums text-(--color-faint)">{new Date(row.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</time>
                  </div>
                  {row.payload === undefined ? null : (
                    <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-all pl-4 font-mono text-[12px] text-(--color-muted)">{row.payload}</pre>
                  )}
                </li>
              ))}
            </ol>
          )}
        </div>
      </section>
    </div>
  );
}
