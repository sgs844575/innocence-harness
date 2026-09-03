// 思考幽灵行（参考规格）：brain 图标 + 「思考 · 持续了几秒」最弱色；
// 流式中 = 渐变动画「正在思考」+ 尾随滚动预览（两端渐隐 mask）；
// 展开 = 左侧竖线缩进的可滚动全文（max-h-60）。chevron 悬停才显现。
import { useState } from "react";
import { Brain, ChevronRight } from "lucide-react";

export function ThinkingRow({
  t,
  text,
  live,
}: {
  t: (key: string) => string;
  text: string;
  live: boolean;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <div className="group/reasoning flex w-full flex-col">
      <button
        type="button"
        aria-expanded={open}
        title={t("chat.thinking.label")}
        onClick={() => setOpen((value) => !value)}
        className="inline-flex max-w-full min-w-0 items-center gap-2 self-start text-left transition-colors"
      >
        <Brain size={16} className="size-4 shrink-0 text-(--color-faint)" aria-hidden />
        {live ? (
          <span key="live" className="text-swap inline-flex min-w-0 flex-1 items-center gap-2">
            <span className="animated-gradient-text shrink-0 font-medium whitespace-nowrap">
              {t("chat.thinking.live")}
            </span>
            {text && (
              <span
                className="min-w-0 flex-1 overflow-hidden whitespace-nowrap text-(--color-muted) [mask-image:linear-gradient(to_right,transparent,black_16px,black_calc(100%-16px),transparent)]"
                aria-hidden
              >
                …{text.slice(-400)}
              </span>
            )}
          </span>
        ) : (
          <span key="done" className="text-swap inline-flex shrink-0 items-center gap-2 whitespace-nowrap">
            <span className="font-medium text-(--color-faint)">{t("chat.thinking.label")}</span>
            <span className="text-(--color-faint)">·</span>
            <span className="text-(--color-faint)">{t("chat.thinking.fewSeconds")}</span>
          </span>
        )}
        <ChevronRight
          size={16}
          aria-hidden
          className={`size-4 shrink-0 text-(--color-faint) transition-[transform,opacity] motion-reduce:transition-none ${
            open ? "rotate-90 opacity-100" : "opacity-0 group-hover/reasoning:opacity-100"
          }`}
        />
      </button>
      <div className="acc-panel" data-open={open}>
        <div className="acc-panel-inner">
          <div className="pt-3">
            <div className="scrollbar-thin ml-2 max-h-60 space-y-2 overflow-auto border-l border-(--color-border) pl-3.5">
              <div className="min-w-0 whitespace-pre-wrap break-words text-(--color-faint)">{text}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
