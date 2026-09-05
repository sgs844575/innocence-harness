import type { ReactNode } from "react";
import { FileDiff } from "lucide-react";
import type { ChatMessage } from "../../../../shared/ipc";
import type { CodeAppearance } from "./MarkdownView";
import { ToolTimeline } from "./ToolRow";
import type { ToolRowModel } from "./toolRows";
import { turnSummary } from "./responseSummaryModel";

export function TurnSummary({ message, enabled, children, t, code, onOpenFile }: {
  message: ChatMessage;
  enabled?: boolean;
  children: ReactNode[];
  t: (key: string) => string;
  code?: CodeAppearance;
  onOpenFile?: (row: ToolRowModel) => void;
}): React.JSX.Element {
  const summary = enabled ? turnSummary(message) : null;
  if (!summary) return <>{children}</>;
  const additions = summary.files.reduce((sum, file) => sum + file.additions, 0);
  const deletions = summary.files.reduce((sum, file) => sum + file.deletions, 0);
  return <>
    <details className="border-b border-(--color-hairline) pb-3" open={summary.hasErrors || undefined}>
      <summary className="text-(--color-muted) focus-visible:outline-(--color-accent)">
        {t(summary.hasErrors ? "chat.summary.processErrors" : "chat.summary.process")}
      </summary>
      <div className="flex flex-col gap-4 pt-4">{children.slice(0, summary.conclusionIndex)}</div>
    </details>
    {children.slice(summary.conclusionIndex)}
    {summary.files.length > 0 && <section aria-label={t("chat.summary.changes")} className="overflow-hidden rounded-(--radius-pop) border border-(--color-border)">
      <div className="flex items-center gap-3 border-b border-(--color-border) bg-(--color-panel) px-3 py-3">
        <FileDiff size={20} strokeWidth={1.5} className="shrink-0 text-(--color-muted)" />
        <div>
          <div className="font-medium text-(--color-foreground-strong)">{t("chat.summary.files").replace("{count}", String(summary.files.length))}</div>
          <div className="flex gap-2 font-mono text-xs" title={t("chat.summary.counts")}>
            <span className="text-(--color-diff-add)">+{additions}</span>
            <span className="text-(--color-diff-del)">−{deletions}</span>
          </div>
        </div>
      </div>
      <div className="max-h-60 overflow-y-auto scrollbar-thin divide-y divide-(--color-hairline)">
        {summary.files.map((file) => <details key={file.path}>
          <summary className="flex items-center gap-3 px-3 py-2 hover:bg-(--color-hover) focus-visible:outline-(--color-accent)">
            <span className="min-w-0 flex-1 truncate font-mono text-xs" title={file.path}>{file.path}</span>
            <span className="shrink-0 font-mono text-xs text-(--color-diff-add)">+{file.additions}</span>
            <span className="shrink-0 font-mono text-xs text-(--color-diff-del)">−{file.deletions}</span>
          </summary>
          <div className="px-3 pb-3"><ToolTimeline t={t} rows={file.rows} code={code} onOpenFile={onOpenFile} /></div>
        </details>)}
      </div>
    </section>}
  </>;
}
