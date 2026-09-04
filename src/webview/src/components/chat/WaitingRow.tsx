// 流式等待行：时间线最底部的转圈 + 轮换的耐心等待提示（chat.waiting.*），
// 文案按 key 重挂载触发 .text-swap 交换动画。
import { useEffect, useState } from "react";
import { LoaderCircle } from "lucide-react";

const HINT_COUNT = 4;
const ROTATE_MS = 3200;

export function WaitingRow({
  t,
  spinner = true,
}: {
  t: (key: string) => string;
  /** 是否带转圈加载图标；子代理运行会话只留轮换文案（spinner=false）。 */
  spinner?: boolean;
}): React.JSX.Element {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => setIndex((current) => (current + 1) % HINT_COUNT), ROTATE_MS);
    return () => clearInterval(timer);
  }, []);

  return (
    <div data-testid="chat-waiting" className="flex items-center gap-2 text-(--color-muted)">
      {spinner && <LoaderCircle size={14} className="shrink-0 animate-spin text-(--color-faint)" aria-hidden />}
      <span key={index} className="text-swap">
        {t(`chat.waiting.${index}`)}
      </span>
    </div>
  );
}
