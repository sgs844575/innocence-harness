import { CircleStop, Gauge } from "lucide-react";
import type { ChatCompletionMetadata } from "../../../../shared/ipc";

export function CompletionMetadata({ completion }: { completion?: ChatCompletionMetadata }): React.JSX.Element | null {
  if (!completion) return null;
  const source = [completion.providerId, completion.modelId].filter(Boolean).join(" / ");
  const total = completion.usage?.totalTokens;
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px] text-(--color-app-muted)" aria-label="completion metadata">
      {source && <span>{source}</span>}
      {total !== undefined && <span className="inline-flex items-center gap-1"><Gauge size={10} />{total} tokens</span>}
      <span className="inline-flex items-center gap-1"><CircleStop size={10} />{completion.finishReason}</span>
    </div>
  );
}
