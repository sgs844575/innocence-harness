import { CircleStop, Gauge } from "lucide-react";
import type { ChatCompletionMetadata } from "../../../../shared/ipc";

export function CompletionMetadata({
  completion,
  providerName,
}: {
  completion?: ChatCompletionMetadata;
  /** 供应商显示名（组装层按 completion.providerId 从 settings.profiles 解析）；
   *  缺省回落原始 profile id——运行时元数据只有 id，不携带显示名。 */
  providerName?: string;
}): React.JSX.Element | null {
  if (!completion) return null;
  const provider = providerName ?? completion.providerId;
  const source = [provider, completion.modelId].filter(Boolean).join(" / ");
  const total = completion.usage?.totalTokens;
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px] text-(--color-app-muted)" aria-label="completion metadata">
      {source && <span>{source}</span>}
      {total !== undefined && <span className="inline-flex items-center gap-1"><Gauge size={10} />{total} tokens</span>}
      <span className="inline-flex items-center gap-1"><CircleStop size={10} />{completion.finishReason}</span>
    </div>
  );
}
