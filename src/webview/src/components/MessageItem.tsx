// 消息行：用户 = 右对齐圆角气泡（悬停出复制；最近一条可编辑重发）；
// 助手 = 无头部帧（思考行/工具时间线/正文段），中断帧带「继续」图标钮。
import { useEffect, useRef, useState } from "react";
import { ArrowUp, Check, Copy, Pencil, RotateCcw, X } from "lucide-react";
import type { ChatMessage } from "../../../shared/ipc";
import { messageText } from "../../../shared/ipc";
import { MarkdownView, type CodeAppearance } from "./chat/MarkdownView";
import { TurnSummary } from "./chat/TurnSummary";
import { ThinkingRow } from "./chat/ThinkingRow";
import { ToolTimeline } from "./chat/ToolRow";
import { segmentParts } from "./chat/segmentParts";
import { buildToolRows, type ToolRowModel } from "./chat/toolRows";
import type { StreamDisplayOptions } from "./chat/toolGrouping";
import { AttachmentStrip } from "./composer/AttachmentChips";
import type { TaskRowClue } from "../state/subagentRuns";

interface Props {
  t: (key: string) => string;
  message: ChatMessage;
  /** 最近一条用户消息（且不在流式）= 可编辑重发。 */
  canEdit?: boolean;
  onEditSend?: (text: string) => void;
  /** 中断的末条助手消息 = 显示「继续」图标钮。 */
  continuable?: boolean;
  onContinue?: () => void;
  /** 代码外观（外观设置）：高亮主题对 + 行号开关。 */
  code?: CodeAppearance;
  /** 消息流显示开关（设置解析结果）：思考关闭 = 每条助手消息只渲染首个
   *  思考块；todo 关闭 = 时间线隐藏 todo 工具行；分组 = 连续同类工具行聚合。
   *  缺省 = 旧行为（全显、不分组）。 */
  stream?: StreamDisplayOptions;
  /** 子代理工具行：在右侧面板中查看该次运行（载荷含关联键/标题/结果文本，
   *  无法唯一确定时落归档列表）。 */
  onOpenSubagent?: (clue: TaskRowClue) => void;
  /** 文件工具行：文件簇点击在右侧 dock 打开文件标签。 */
  onOpenFile?: (row: ToolRowModel) => void;
}

export function MessageItem({ t, message, canEdit, onEditSend, continuable, onContinue, code, onOpenSubagent, onOpenFile, stream }: Props): React.JSX.Element {
  if (message.role === "user") {
    return <UserBubble t={t} message={message} canEdit={canEdit === true} onEditSend={onEditSend} />;
  }

  const streaming = message.streaming === true;
  const segments = segmentParts(message.parts);
  // 思考显示关闭：每条助手消息只渲染首个思考块，后续思考段跳过。
  let thinkingSeen = false;
  // 段间距 16px（参考行列表 gap-4）：思考行/工具时间线/正文段之间统一节奏。
  return (
    <div className="rise-in group/assistant-row flex flex-col gap-4">
      <TurnSummary message={message} enabled={stream?.aggregateResponse && !continuable} t={t} code={code} onOpenFile={onOpenFile}>
      {segments.map((segment, index) => {
        if (segment.kind === "thinking") {
          if (stream !== undefined && !stream.showThinking) {
            if (thinkingSeen) return null;
            thinkingSeen = true;
          }
          return (
            <ThinkingRow
              key={index}
              t={t}
              text={segment.text}
              live={streaming && index === segments.length - 1}
            />
          );
        }
        if (segment.kind === "tools") {
          // todo 显示关闭：过滤 todo 工具行（胶囊清单数据源 latestTodos 不受影响）；
          // 段内行被滤空时整段不渲染。
          const rows = buildToolRows(segment.parts).filter(
            (row) => stream === undefined || stream.showTodos || row.verbKey !== "tool.verb.todo",
          );
          if (rows.length === 0) return null;
          return <ToolTimeline key={index} t={t} rows={rows} code={code} onOpenSubagent={onOpenSubagent} onOpenFile={onOpenFile} grouping={stream?.grouping} />;
        }
        return (
          <div key={index} className="min-h-6">
            <MarkdownView source={segment.text} animated={streaming} code={code} />
          </div>
        );
      })}
      </TurnSummary>
      {streaming && message.parts.length === 0 && (
        <div className="flex items-center gap-1.5 text-(--color-faint)">
          <LoaderCircleInline />
          {t("chat.thinking.live")}
        </div>
      )}
      {/* 中断帧的「继续」图标钮（参考规格：异常中断时挂在最近一条消息上）。 */}
      {continuable && (
        <div>
          <button
            type="button"
            onClick={onContinue}
            aria-label={t("chat.continue")}
            title={t("chat.continue")}
            className="grid size-7 place-items-center rounded-full border border-(--color-border) text-(--color-muted) hover:bg-(--color-hover) hover:text-(--color-foreground)"
          >
            <RotateCcw size={13} strokeWidth={1.5} />
          </button>
        </div>
      )}
      {/* 悬停动作行（参考规格）：复制 + 时间戳，opacity-0 → hover 显现。 */}
      {!streaming && message.parts.length > 0 && (
        <div className="mt-1 flex items-center gap-1 opacity-0 transition-opacity group-hover/assistant-row:opacity-100 focus-within:opacity-100">
          <CopyButton t={t} text={messageText(message.parts)} />
          <time className="select-none text-[12px] text-(--color-faint)" dateTime={new Date(message.createdAt).toISOString()}>
            {new Date(message.createdAt).toTimeString().slice(0, 5)}
          </time>
        </div>
      )}
    </div>
  );
}

/** 用户气泡：悬停出复制；最近一条额外出编辑钮——编辑中气泡换为文本域，
 *  Enter 或发送图标钮确认（替换原消息重发，历史截断）、Esc 或取消图标钮退出。 */
function UserBubble({
  t,
  message,
  canEdit,
  onEditSend,
}: {
  t: (key: string) => string;
  message: ChatMessage;
  canEdit: boolean;
  onEditSend?: (text: string) => void;
}): React.JSX.Element {
  const text = messageText(message.parts);
  // 附件 part 独立于文本渲染（气泡内附件条：图像直显 + 文件 chip）。
  const attachmentParts = message.parts.filter(
    (part): part is Extract<typeof part, { type: "attachment" }> => part.type === "attachment",
  );
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(text);
  const areaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (editing) {
      const el = areaRef.current;
      if (el) {
        el.focus();
        el.setSelectionRange(el.value.length, el.value.length);
      }
    }
  }, [editing]);

  const submit = (): void => {
    const next = draft.trim();
    if (!next) return;
    setEditing(false);
    onEditSend?.(next);
  };

  const cancel = (): void => {
    setDraft(text);
    setEditing(false);
  };

  return (
    <div className="rise-in group/user-row flex flex-col items-end">
      {editing ? (
        <div className="flex w-full max-w-xl flex-col gap-2">
          <textarea
            ref={areaRef}
            value={draft}
            rows={Math.min(8, draft.split("\n").length + 1)}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                submit();
              }
              if (event.key === "Escape") {
                event.preventDefault();
                cancel();
              }
            }}
            aria-label={t("chat.edit")}
            className="scrollbar-thin w-full resize-none rounded-xl border border-(--color-border-hover) bg-(--color-surface) px-4 py-3 leading-relaxed outline-none text-(--color-foreground)"
          />
          {/* 编辑动作行：发送图标钮确认重发（与输入卡发送钮同图标）、取消图标钮退出。 */}
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              aria-label={t("chat.edit.send")}
              title={t("chat.edit.send")}
              disabled={!draft.trim()}
              onClick={submit}
              className="grid size-7 place-items-center rounded-md border border-(--color-border) bg-(--color-raised) text-(--color-foreground) hover:bg-(--color-hover) disabled:opacity-40"
            >
              <ArrowUp size={14} strokeWidth={2} />
            </button>
            <button
              type="button"
              aria-label={t("chat.edit.cancel")}
              title={t("chat.edit.cancel")}
              onClick={cancel}
              className="grid size-7 place-items-center rounded-md text-(--color-muted) hover:bg-(--color-hover) hover:text-(--color-foreground)"
            >
              <X size={14} />
            </button>
          </div>
        </div>
      ) : (
        <div className="flex max-w-xl flex-col gap-2 rounded-xl rounded-tr-[2px] border border-(--color-border) bg-(--color-surface) px-4 py-3 leading-relaxed whitespace-pre-wrap break-words text-(--color-foreground)">
          <AttachmentStrip parts={attachmentParts} />
          {text}
        </div>
      )}
      {!editing && (
        <div className="mt-1 flex items-center gap-1 opacity-0 transition-opacity group-hover/user-row:opacity-100 focus-within:opacity-100">
          <CopyButton t={t} text={text} />
          {canEdit && (
            <button
              type="button"
              aria-label={t("chat.edit")}
              title={t("chat.edit")}
              onClick={() => {
                setDraft(text);
                setEditing(true);
              }}
              className="grid size-7 place-items-center rounded-md text-(--color-muted) hover:bg-(--color-hover) hover:text-(--color-foreground)"
            >
              <Pencil size={14} />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** 悬停复制钮（用户气泡/助手动作行共用；dock 子代理对话视图复用）。 */
export function CopyButton({ t, text }: { t: (key: string) => string; text: string }): React.JSX.Element {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      aria-label={copied ? t("chat.copied") : t("chat.copy")}
      title={copied ? t("chat.copied") : t("chat.copy")}
      onClick={() => {
        void navigator.clipboard?.writeText(text).catch(() => undefined);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className="grid size-7 place-items-center rounded-md text-(--color-muted) hover:bg-(--color-hover) hover:text-(--color-foreground)"
    >
      {copied ? <Check size={14} className="text-(--color-tool-ok)" /> : <Copy size={14} />}
    </button>
  );
}

function LoaderCircleInline(): React.JSX.Element {
  return <span className="inline-block size-3 animate-spin rounded-full border border-(--color-border) border-t-(--color-foreground)" />;
}
