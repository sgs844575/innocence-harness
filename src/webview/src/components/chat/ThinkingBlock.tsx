import { useState } from "react";
import { ChevronRight } from "lucide-react";

/** 思考行（参考稿 think-row）：光球呼吸（orbs）+ 状态文案，
 * 点击展开完整思考预览。live 时流光预览尾部文本。 */
export function ThinkingBlock({ text, live, t }: { text: string; live: boolean; t: (key: string) => string }): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const secs = Math.max(1, Math.round(text.length / 400)); // 字数近似时长，无服务端时间戳
  return (
    <div className="py-0.5">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex w-full items-center gap-2.5 py-1 text-left text-[13px] text-(--color-app-muted) hover:text-(--color-app-text)">
        <ChevronRight size={12} className={`shrink-0 transition-transform ${open ? "rotate-90" : ""}`} />
        <span className="orbs shrink-0" aria-hidden>
          <i />
          <i />
          <i />
        </span>
        {live ? (
          // 多行换行的思考预览：取尾部约 400 字符，限高渐隐，shimmer 流光。
          <span className="shimmer think-preview min-w-0 flex-1">
            {text.slice(-400) || t("chat.thinking.live")}
          </span>
        ) : (
          <span className="truncate">{t("chat.thinking.done").replace("{n}", String(secs))}</span>
        )}
      </button>
      {open && (
        <pre className="scrollbar-thin mt-1 max-h-60 overflow-y-auto whitespace-pre-wrap break-words border-l border-(--color-app-hairline) pl-3 text-[12px] leading-relaxed text-(--color-app-muted)">{text}</pre>
      )}
    </div>
  );
}
