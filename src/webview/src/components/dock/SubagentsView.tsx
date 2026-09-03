// 「子代理」标签的内容视图（从 RightDock 按职责拆出）：列表 ↔ 对话双视图。
// 对话视图与主聊天时间线同一表现语言——用户气泡（hover 复制）、思考幽灵行、
// 同一 ToolRow 工具轨迹（动词/图标/摘要/展开详情）、Markdown 正文 + 悬停
// 动作行（复制 + 时间戳）、流式等待行。
import { useEffect, useRef } from "react";
import { Bot, ChevronLeft, ChevronRight, CircleCheck, CircleSlash, CircleX, LoaderCircle } from "lucide-react";
import { formatRunDuration, groupRunsByLiveness, pairedRunTools, runConversationChunks, type SubagentRun } from "../../state/subagentRuns";
import { runToolsToTimelineRows } from "../chat/toolRows";
import { MarkdownView, type CodeAppearance } from "../chat/MarkdownView";
import { ThinkingRow } from "../chat/ThinkingRow";
import { WaitingRow } from "../chat/WaitingRow";
import { ToolTimeline } from "../chat/ToolRow";
import { CopyButton } from "../MessageItem";

export function isRunning(run: SubagentRun): boolean {
  return run.status === "started" || run.status === "running";
}

function statusIcon(run: SubagentRun): React.JSX.Element {
  if (run.status === "completed")
    return <CircleCheck size={14} strokeWidth={1.5} className="shrink-0 text-(--color-tool-ok)" aria-hidden />;
  if (run.status === "failed")
    return <CircleX size={14} strokeWidth={1.5} className="shrink-0 text-(--color-tool-err)" aria-hidden />;
  if (run.status === "cancelled")
    return <CircleSlash size={14} strokeWidth={1.5} className="shrink-0 text-(--color-faint)" aria-hidden />;
  return <LoaderCircle size={14} strokeWidth={1.5} className="shrink-0 animate-spin text-(--color-accent)" aria-hidden />;
}

/** 列表视图卡片：状态图标 + 预设徽章 + 描述 + 状态·时长；给文本尾部两行预览。 */
export function RunCard({
  t,
  run,
  onOpen,
}: {
  t: (key: string) => string;
  run: SubagentRun;
  onOpen: () => void;
}): React.JSX.Element {
  const duration = formatRunDuration(run.startedAt, run.endedAt ?? Date.now());
  return (
    <button
      type="button"
      onClick={onOpen}
      className="block w-full rounded-(--radius-pop) border border-(--color-border) bg-(--color-raised) px-3 py-2.5 text-left transition-colors hover:border-(--color-border-hover)"
    >
      <span className="flex min-w-0 items-center gap-2">
        {statusIcon(run)}
        {run.agentType && (
          <span className="shrink-0 rounded-md bg-(--color-selected) px-1.5 py-0.5 font-mono text-[11px] leading-none text-(--color-muted)">
            {run.agentType}
          </span>
        )}
        <span className="min-w-0 truncate text-(--color-foreground)">
          {run.description || run.agentType || t("dock.subagents")}
        </span>
      </span>
      <span className="mt-0.5 block text-[12px] text-(--color-faint)">
        {t(`dock.status.${run.status}`)} · <span className="font-mono tabular-nums">{duration}</span>
      </span>
      {run.text && (
        <span className="mt-1 line-clamp-2 block text-[13px] leading-relaxed break-words text-(--color-muted)">
          {run.text.slice(-240)}
        </span>
      )}
    </button>
  );
}

/** 对话视图：选中运行的完整对话——与主聊天时间线同一表现：prompt 用户气泡
 *  （hover 复制）、思考幽灵行与工具轨迹按事件顺序穿插（思考被工具活动打断
 *  即分段，不再并成一行）、ToolRow 工具行、Markdown 正文（运行中流式
 *  光标，完成后悬停复制 + 时间戳）、等待行与错误块。 */
export function RunConversation({
  t,
  run,
  onBack,
  code,
}: {
  t: (key: string) => string;
  run: SubagentRun;
  onBack: () => void;
  code?: CodeAppearance;
}): React.JSX.Element {
  const running = isRunning(run);
  const body = run.final ?? run.text;
  const stamp = new Date(run.endedAt ?? run.startedAt);
  const scrollRef = useRef<HTMLDivElement>(null);
  const chunks = runConversationChunks(run.entries);
  const lastIndex = chunks.length - 1;
  const thinkingLive = running && !body;

  // 运行中且用户贴底（<48px）时保持钉底，上滚即释放——与时间线同规则。
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !running) return;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 48) el.scrollTop = el.scrollHeight;
  }, [running, run.text, run.final, run.entries]);
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
        <div ref={scrollRef} className="scrollbar-thin h-full min-w-0 overflow-y-auto">
          {/* 消息渲染与主聊天同语言同节奏（32px 消息间距）：prompt = 用户气泡
              （右对齐、3px 尾角、hover 复制），chunks = 思考幽灵行与工具时间线
              按事件顺序穿插，正文 = Markdown 帧（运行中流式光标），错误 = ⚠ 前缀
              正文行，空等 = 轮换耐心提示。 */}
          <div className="space-y-8 px-3 py-4">
            {run.prompt && (
              <div className="rise-in group/user-row flex flex-col items-end">
                <div className="flex max-w-xl flex-col gap-2 rounded-xl rounded-tr-[2px] border border-(--color-border) bg-(--color-surface) px-4 py-3 leading-relaxed whitespace-pre-wrap break-words text-(--color-foreground)">
                  {run.prompt}
                </div>
                <div className="mt-1 flex items-center gap-1 opacity-0 transition-opacity group-hover/user-row:opacity-100 focus-within:opacity-100">
                  <CopyButton t={t} text={run.prompt} />
                </div>
              </div>
            )}
            {chunks.map((chunk, index) =>
              chunk.kind === "thinking" ? (
                <ThinkingRow key={`think-${index}`} t={t} text={chunk.text} live={thinkingLive && index === lastIndex} />
              ) : (
                <ToolTimeline key={`tools-${index}`} t={t} rows={runToolsToTimelineRows(pairedRunTools(chunk.tools))} />
              ),
            )}
            {body && (
              <div className="rise-in group/assistant-row flex flex-col gap-4">
                <div className="min-h-6">
                  <MarkdownView source={body} animated={running} code={code} />
                  {running && <span className="stream-caret" aria-hidden />}
                </div>
                {!running && (
                  <div className="mt-1 flex items-center gap-1 opacity-0 transition-opacity group-hover/assistant-row:opacity-100 focus-within:opacity-100">
                    <CopyButton t={t} text={body} />
                    <time className="select-none text-[12px] text-(--color-faint)" dateTime={stamp.toISOString()}>
                      {stamp.toTimeString().slice(0, 5)}
                    </time>
                  </div>
                )}
              </div>
            )}
            {!body && running && chunks.length === 0 && <WaitingRow t={t} />}
            {run.error && <div className="leading-relaxed break-words text-(--color-foreground)">⚠ {run.error}</div>}
          </div>
        </div>
      </div>
    </div>
  );
}

/** 列表视图（含空态）——主列表只展示进行中的子代理；终态（完成/失败/取消）
 *  全部归档进「查看全部」次级视图（archive=true，胶囊「查看全部」直达），
 *  返回钮回到进行中列表。两组各自按创建时间倒序（新→旧）。 */
export function SubagentsList({
  t,
  runs,
  onOpen,
  archive = false,
  onArchive,
}: {
  t: (key: string) => string;
  runs: SubagentRun[];
  onOpen: (childId: string) => void;
  /** 归档视图（已完成的子代理）。 */
  archive?: boolean;
  onArchive?: (open: boolean) => void;
}): React.JSX.Element {
  const groups = groupRunsByLiveness(runs);
  const groupLabel = "px-1 pb-1 text-[12px] text-(--color-faint) select-none";
  if (archive) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex h-10 shrink-0 items-center gap-2 border-b border-(--color-hairline) px-2">
          <button
            type="button"
            onClick={() => onArchive?.(false)}
            aria-label={t("dock.back")}
            title={t("dock.back")}
            className="grid size-7 shrink-0 place-items-center rounded-md text-(--color-muted) hover:bg-(--color-hover) hover:text-(--color-foreground)"
          >
            <ChevronLeft size={15} strokeWidth={1.5} />
          </button>
          <span className="min-w-0 flex-1 truncate text-(--color-foreground)">
            {t("dock.subagents.completedGroup")}
          </span>
          <span className="shrink-0 font-mono text-[12px] tabular-nums text-(--color-faint)">
            {groups.completed.length}
          </span>
        </div>
        <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
          {groups.completed.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center text-(--color-faint)">
              <Bot size={22} strokeWidth={1.3} aria-hidden />
              <span className="text-[13px]">{t("dock.subagents.completedGroup")}</span>
            </div>
          ) : (
            <div className="space-y-2.5 p-3">
              {groups.completed.map((run) => (
                <RunCard key={run.childId} t={t} run={run} onOpen={() => onOpen(run.childId)} />
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }
  return (
    <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
      {runs.length === 0 ? (
        <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center text-(--color-faint)">
          <Bot size={22} strokeWidth={1.3} aria-hidden />
          <span className="text-[13px]">{t("dock.empty")}</span>
        </div>
      ) : (
        <div className="space-y-3 p-3">
          {groups.running.length > 0 ? (
            <section>
              <div className={groupLabel}>{t("dock.subagents.runningGroup")}</div>
              <div className="space-y-2.5">
                {groups.running.map((run) => (
                  <RunCard key={run.childId} t={t} run={run} onOpen={() => onOpen(run.childId)} />
                ))}
              </div>
            </section>
          ) : (
            <div className="px-1 py-6 text-center text-[13px] text-(--color-faint)">
              {t("dock.subagents.liveEmpty")}
            </div>
          )}
          {/* 「查看全部 N ›」：终态运行全部收进归档视图，主列表不混排。 */}
          {groups.completed.length > 0 && (
            <button
              type="button"
              onClick={() => onArchive?.(true)}
              title={t("capsule.subagents.openList")}
              className="flex w-full items-center gap-2 rounded-(--radius-pop) px-1 py-1.5 text-(--color-muted) transition-colors hover:bg-(--color-hover) hover:text-(--color-foreground)"
            >
              <Bot size={14} strokeWidth={1.5} className="shrink-0" aria-hidden />
              <span>{t("dock.subagents.viewAll")}</span>
              <span className="ml-auto font-mono text-[12px] tabular-nums text-(--color-muted)">
                {groups.completed.length}
              </span>
              <ChevronRight size={12} className="shrink-0 text-(--color-faint)" aria-hidden />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
