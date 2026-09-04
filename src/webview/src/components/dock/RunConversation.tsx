// 「子代理」标签的运行会话视图（从 SubagentsView 按职责拆出）：与主聊天时间线
// 同一表现语言——prompt 用户气泡（hover 复制）、思考幽灵行、富工具行（动词/
// 文件名/路径/±diff 计数/可展开明细，文件簇点开 dock 文件标签）、正文按段
// 与工具轨迹穿插（textSegment 闭合段 Markdown 帧 + 未闭合流式帧，旧档案回退
// 为末尾整段正文）、运行空档的无转圈耐心提示与错误块。段间距同主时间线：轮内
// 16px、prompt 气泡相邻 32px；滚动同主时间线方向感知钉底（上滚释放、<48px
// 回钉、钉底时后续消息与异步高度增长即时跟踪到底）。
import { useEffect, useRef, useState } from "react";
import { ChevronLeft } from "lucide-react";
import { formatRunDuration, pairedRunTools, runConversationChunks, type SubagentRun } from "../../state/subagentRuns";
import { runToolsToTimelineRows, type ToolRowModel } from "../chat/toolRows";
import type { ToolGroupingOptions } from "../chat/toolGrouping";
import { MarkdownView, type CodeAppearance } from "../chat/MarkdownView";
import { ThinkingRow } from "../chat/ThinkingRow";
import { WaitingRow } from "../chat/WaitingRow";
import { ToolTimeline } from "../chat/ToolRow";
import { CopyButton } from "../MessageItem";
import { isRunning, statusIcon } from "./SubagentsView";

/** prompt 用户气泡（右对齐、3px 尾角、hover 复制）：初始 prompt 与续跑
 *  prompt 共用同一形态。 */
function PromptBubble({ t, text }: { t: (key: string) => string; text: string }): React.JSX.Element {
  return (
    <div className="rise-in group/user-row flex flex-col items-end">
      <div className="flex max-w-xl flex-col gap-2 rounded-xl rounded-tr-[2px] border border-(--color-border) bg-(--color-surface) px-4 py-3 leading-relaxed whitespace-pre-wrap break-words text-(--color-foreground)">
        {text}
      </div>
      <div className="mt-1 flex items-center gap-1 opacity-0 transition-opacity group-hover/user-row:opacity-100 focus-within:opacity-100">
        <CopyButton t={t} text={text} />
      </div>
    </div>
  );
}

/** 助手正文帧（与主时间线正文段同形态）：已闭合正文段与旧档案整段正文共用；
 *  completed 后悬停出复制 + 时间戳。 */
function AssistantFrame({
  t,
  text,
  code,
  stamp,
  hoverActions = false,
}: {
  t: (key: string) => string;
  text: string;
  code?: CodeAppearance;
  /** 悬停动作行的时间锚（endedAt）。 */
  stamp: Date;
  /** 非 running 的末个正文帧带 hover 复制 + 时间戳。 */
  hoverActions?: boolean;
}): React.JSX.Element {
  return (
    <div className="rise-in group/assistant-row flex flex-col gap-4">
      <div className="min-h-6">
        <MarkdownView source={text} animated={false} code={code} />
      </div>
      {hoverActions && (
        <div className="mt-1 flex items-center gap-1 opacity-0 transition-opacity group-hover/assistant-row:opacity-100 focus-within:opacity-100">
          <CopyButton t={t} text={text} />
          <time className="select-none text-[12px] text-(--color-faint)" dateTime={stamp.toISOString()}>
            {stamp.toTimeString().slice(0, 5)}
          </time>
        </div>
      )}
    </div>
  );
}

/** 对话视图：选中运行的完整对话——与主聊天时间线同一表现：prompt 用户气泡
 *  （hover 复制）、思考幽灵行与富工具轨迹按事件顺序穿插（思考/正文被工具
 *  活动打断即分段；续跑 prompt 追加为同形态气泡）、正文按段渲染（已闭合
 *  textSegment 段 Markdown 帧 + 运行中未闭合尾部的流式帧；无任何闭合段的
 *  旧档案回退为末尾整段 final/text 正文，完成后悬停复制 + 时间戳）、等待行
 *  与错误块。 */
export function RunConversation({
  t,
  run,
  onBack,
  code,
  onOpenFile,
  grouping,
}: {
  t: (key: string) => string;
  run: SubagentRun;
  onBack: () => void;
  code?: CodeAppearance;
  /** 文件行（编辑/写入/读取）：文件簇点击在右侧 dock 打开文件标签。 */
  onOpenFile?: (row: ToolRowModel) => void;
  /** 工具分组开关（与主时间线同一 ToolTimeline 管线）；缺省 = 平铺。 */
  grouping?: ToolGroupingOptions;
}): React.JSX.Element {
  const running = isRunning(run);
  const stamp = new Date(run.endedAt ?? run.startedAt);
  const scrollRef = useRef<HTMLDivElement>(null);
  const chunks = runConversationChunks(run.entries);
  const lastIndex = chunks.length - 1;
  // 未闭合流式尾部：run.text 扣除已入 text 条目的闭合段；仅运行中渲染。
  const openText = running ? run.text.slice(run.closedTextLength ?? 0) : "";
  const textChunkIndexes = chunks.flatMap((chunk, index) => (chunk.kind === "text" ? [index] : []));
  const lastTextIndex = textChunkIndexes[textChunkIndexes.length - 1];
  // 旧档案回退：终态且没有任何闭合正文段时维持末尾整段正文。
  const fallbackBody = !running && lastTextIndex === undefined ? (run.final ?? run.text) : "";
  const thinkingLive = running && !openText;

  // 贴底策略与主时间线同律：用户上滚（scrollTop 减小）→ 暂停跟随；回到底部
  //（距底 <48px）→ 恢复跟随。钉底期间后续事件/流式正文即时跟踪到底。
  const [pinned, setPinned] = useState(true);
  const lastScrollTop = useRef(0);
  const pinnedRef = useRef(pinned);
  pinnedRef.current = pinned;

  const scrollToBottom = (): void => {
    const el = scrollRef.current;
    // scrollTop = scrollHeight 直达内容真底部（含列 padding）。
    if (el) el.scrollTop = el.scrollHeight;
  };

  const onScroll = (): void => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
    const wentUp = el.scrollTop < lastScrollTop.current;
    lastScrollTop.current = el.scrollTop;
    if (wentUp && !atBottom) setPinned(false);
    else if (atBottom) setPinned(true);
  };

  // 切运行回到贴底并直达末尾（与主时间线切会话同律）。
  useEffect(() => {
    setPinned(true);
    scrollToBottom();
  }, [run.childId]);

  // 钉底时内容更新（新条目/流式正文/终态）即时跟随到底——流式增长快，
  // 不用 smooth 动画。
  useEffect(() => {
    if (pinned) scrollToBottom();
  }, [pinned, run]);

  // 不改变 run 引用的高度增长（异步代码高亮等）同样跟随到底。
  useEffect(() => {
    const column = scrollRef.current?.firstElementChild;
    if (!column || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      if (pinnedRef.current) scrollToBottom();
    });
    observer.observe(column);
    return () => observer.disconnect();
  }, []);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-(--color-hairline) px-2">
        <button
          type="button"
          onClick={onBack}
          aria-label={t("dock.back")}
          title={t("dock.back")}
          className="grid size-7 shrink-0 place-items-center rounded-md text-(--color-muted) hover:bg-(--color-hover) hover:text-(--color-foreground)"
        >
          <ChevronLeft size={15} strokeWidth={1.5} />
        </button>
        {statusIcon(run)}
        <span className="min-w-0 flex-1 truncate text-(--color-foreground)">
          {run.description || run.agentType || t("dock.subagents")}
        </span>
        <span className="shrink-0 text-[12px] text-(--color-faint)">
          {t(`dock.status.${run.status}`)} ·{" "}
          <span className="font-mono tabular-nums">{formatRunDuration(run.startedAt, run.endedAt ?? Date.now())}</span>
        </span>
      </div>
      <div className="min-h-0 flex-1">
        <div ref={scrollRef} onScroll={onScroll} className="scrollbar-thin h-full min-w-0 overflow-y-auto">
          {/* 段间距与主时间线同律：轮内（思考幽灵行/正文段帧/富工具时间线）统一
              16px；prompt 气泡（初始/续跑）与相邻内容之间为消息级 32px。未闭合
              尾部 = 流式 Markdown 帧（流式光标），错误 = ⚠ 前缀正文行，运行空档 =
              无转圈的轮换耐心提示（末段 live 思考幽灵行自带动态标签时不重复）。 */}
          <div className="px-3 py-4">
            {run.prompt && <PromptBubble t={t} text={run.prompt} />}
            {chunks.map((chunk, index) => {
              const prevKind = index > 0 ? chunks[index - 1]!.kind : run.prompt ? ("prompt" as const) : undefined;
              const gap =
                prevKind === undefined ? "" : chunk.kind === "prompt" || prevKind === "prompt" ? "mt-8" : "mt-4";
              return (
                <div
                  key={`${chunk.kind}-${index}`}
                  className={gap}
                >
                  {chunk.kind === "thinking" ? (
                    <ThinkingRow t={t} text={chunk.text} live={thinkingLive && index === lastIndex} />
                  ) : chunk.kind === "prompt" ? (
                    <PromptBubble t={t} text={chunk.text} />
                  ) : chunk.kind === "text" ? (
                    <AssistantFrame
                      t={t}
                      text={chunk.text}
                      code={code}
                      stamp={stamp}
                      hoverActions={!running && index === lastTextIndex}
                    />
                  ) : (
                    <ToolTimeline
                      t={t}
                      rows={runToolsToTimelineRows(pairedRunTools(chunk.tools))}
                      code={code}
                      onOpenFile={onOpenFile}
                      grouping={grouping}
                    />
                  )}
                </div>
              );
            })}
            {(() => {
              const lastKind = chunks.length > 0 ? chunks[chunks.length - 1]!.kind : run.prompt ? ("prompt" as const) : undefined;
              const tailGap = lastKind === undefined ? "" : lastKind === "prompt" ? "mt-8" : "mt-4";
              // 运行中且无未闭合流式正文时给出轮换耐心提示：末段为 thinking 时
              // 幽灵行自身已带 live「正在思考」渐变标签，等待行不重复；提示只留
              // 文案（无转圈加载）。
              const waiting = running && !openText && lastKind !== "thinking";
              return (
                <>
                  {openText && (
                    <div className={`rise-in flex flex-col gap-4 ${tailGap}`}>
                      <div className="min-h-6">
                        <MarkdownView source={openText} animated code={code} />
                        <span className="stream-caret" aria-hidden />
                      </div>
                    </div>
                  )}
                  {fallbackBody && (
                    <div className={tailGap}>
                      <AssistantFrame t={t} text={fallbackBody} code={code} stamp={stamp} hoverActions />
                    </div>
                  )}
                  {waiting && (
                    <div className={tailGap}>
                      <WaitingRow t={t} spinner={false} />
                    </div>
                  )}
                  {run.error && (
                    <div className={`leading-relaxed break-words text-(--color-foreground) ${tailGap}`}>⚠ {run.error}</div>
                  )}
                </>
              );
            })()}
          </div>
        </div>
      </div>
    </div>
  );
}
