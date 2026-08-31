// 助手消息帧（参考稿语言）：无头部——正文/思考行/工具时间线直接铺开，
// 复制/引用收进右上角悬停操作。msg 段 = 14px 半粗正文。
import { useState } from "react";
import { Copy, Quote } from "lucide-react";
import { messageText, type MessagePart } from "../../../../shared/ipc";
import { MarkdownView } from "./MarkdownView";
import { ThinkingBlock } from "./ThinkingBlock";
import { TurnCollapse } from "./TurnCollapse";
import { WorkingRow, workingStateOf } from "./WorkingRow";
import { coalesceToolSegments, segmentParts } from "./segmentParts";

interface Props {
  parts: MessagePart[];
  streaming: boolean;
  isLatest: boolean;
  t: (key: string) => string;
  onQuote: (text: string) => void;
}

export function MessageFrame({ parts, streaming, isLatest, t, onQuote }: Props): React.JSX.Element {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    void navigator.clipboard.writeText(messageText(parts)).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  // 流式期间逐段渲染（贴近执行过程）；整轮完成后工具段归并成连续时间线。
  const segments = streaming ? segmentParts(parts) : coalesceToolSegments(segmentParts(parts));
  return (
    <div className="group/msg relative">
      {/* 悬停操作：复制 / 引用（不占版面，仅悬停浮现） */}
      <div className={`absolute -top-1 right-0 z-10 flex items-center gap-3 text-[11px] text-(--color-app-muted) transition-opacity duration-150 ${isLatest ? "opacity-100" : "opacity-0 group-hover/msg:opacity-100"}`}>
        <button type="button" onClick={copy} aria-label={t("chat.copy")} title={t("chat.copy")} className="flex items-center gap-1 hover:text-(--color-app-text)">
          <Copy size={12} />{copied ? t("chat.copied") : t("chat.copy")}
        </button>
        <button type="button" onClick={() => onQuote(messageText(parts))} aria-label={t("chat.quote")} title={t("chat.quote")} className="flex items-center gap-1 hover:text-(--color-app-text)">
          <Quote size={12} />{t("chat.quote")}
        </button>
      </div>
      {segments.map((seg, i) => {
        if (seg.kind === "thinking")
          // live 只在"思考是当前活动"（仍是末段）时为真——整条消息还在流式
          // 但已进入正文/工具阶段时，思考块必须收成静态的"已思考 N 秒"，
          // 否则 shimmer 流光会在思考结束后一直闪。
          return (
            <ThinkingBlock
              key={i}
              text={seg.text}
              live={streaming && i === segments.length - 1}
              t={t}
            />
          );
        if (seg.kind === "tools") return <TurnCollapse key={i} parts={seg.parts} />;
        return (
          <div key={i} className="msg-body min-h-6">
            <MarkdownView source={seg.text} animated={streaming} t={t} />
            {streaming && i === segments.length - 1 && <span className="stream-caret" aria-label="streaming" />}
          </div>
        );
      })}
      {streaming && <WorkingRow state={workingStateOf(parts)} t={t} />}
    </div>
  );
}
