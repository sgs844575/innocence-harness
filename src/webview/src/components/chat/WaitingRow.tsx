// 流式等待行：时间线最底部的转圈 + 轮换的耐心等待提示（chat.waiting.*），
// 文案按 key 重挂载触发 .text-swap 交换动画。
import { useEffect, useState } from "react";
import { LoaderCircle } from "lucide-react";

const HINT_COUNT = 4;
const ROTATE_MS = 3200;

export function WaitingRow({ t }: { t: (key: string) => string }): React.JSX.Element {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => setIndex((current) => (current + 1) % HINT_COUNT), ROTATE_MS);
    return () => clearInterval(timer);
  }, []);

  return (
    <div data-testid="chat-waiting" className="flex items-center gap-2 text-(--color-muted)">
      <LoaderCircle size={14} className="shrink-0 animate-spin text-(--color-faint)" aria-hidden />
      <span key={index} className="text-swap">
        {t(`chat.waiting.${index}`)}
      </span>
    </div>
  );
}
