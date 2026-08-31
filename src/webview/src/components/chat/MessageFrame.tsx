// 助手消息帧（参考稿语言）：无头部——正文/思考行/工具时间线直接铺开，
// 不带悬停操作行（复制/引用入口已按用户要求移除）。msg 段 = 14px 半粗正文。
import type { MessagePart } from "../../../../shared/ipc";
import { MarkdownView } from "./MarkdownView";
import { ThinkingBlock } from "./ThinkingBlock";
import { TurnCollapse } from "./TurnCollapse";
import { WorkingRow, workingStateOf } from "./WorkingRow";
import { coalesceToolSegments, segmentParts } from "./segmentParts";

interface Props {
  parts: MessagePart[];
  streaming: boolean;
  t: (key: string) => string;
}

export function MessageFrame({ parts, streaming, t }: Props): React.JSX.Element {
  // 流式期间逐段渲染（贴近执行过程）；整轮完成后工具段归并成连续时间线。
  const segments = streaming ? segmentParts(parts) : coalesceToolSegments(segmentParts(parts));
  return (
    <div className="group/msg relative">
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
