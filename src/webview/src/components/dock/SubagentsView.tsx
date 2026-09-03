// 「子代理」标签的内容视图（从 RightDock 按职责拆出）：列表 ↔ 对话双视图、
// 状态图标与工具轨迹。工具轨迹与主时间线同语言——动词（i18n）+ 参数摘要
//（mono）+ 尾部状态；行点击展开结果摘录（错误红），与 ToolRow 的展开一致。
import { useEffect, useRef, useState } from "react";
import {
  Bot,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  CircleSlash,
  CircleX,
  LoaderCircle,
  Wrench,
  X,
} from "lucide-react";
import { formatRunDuration, pairedRunTools, type SubagentRun } from "../../state/subagentRuns";
import { verbKeyFor } from "../chat/toolRows";
import { MarkdownView, type CodeAppearance } from "../chat/MarkdownView";

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

/** 子工具轨迹行：图标 + 动词（运行中渐变文字）+ 参数摘要 + 尾部状态；点击
 *  行展开该次调用的结果摘录（acc-panel，与主时间线展开同语言）。 */
function RunToolRow({
  t,
  tool,
}: {
  t: (key: string) => string;
  tool: ReturnType<typeof pairedRunTools>[number];
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <div className="w-full">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        title={tool.title ?? t(verbKeyFor(tool.name))}
        className="flex w-full min-w-0 cursor-pointer items-center gap-2 text-left"
      >
        <Wrench size={16} strokeWidth={1.4} className="size-4 shrink-0 text-(--color-muted)" aria-hidden />
        <span
          className={`shrink-0 font-medium whitespace-nowrap ${
            !tool.done ? "animated-gradient-text" : "text-(--color-faint)"
          }`}
        >
          {t(verbKeyFor(tool.name))}
        </span>
        {tool.title && <span className="min-w-0 truncate font-mono text-(--color-muted)">{tool.title}</span>}
        <span className="min-w-4 flex-1" />
        {!tool.done ? (
          <LoaderCircle size={13} strokeWidth={1.5} className="size-3.5 shrink-0 animate-spin text-(--color-accent)" aria-hidden />
        ) : tool.isError ? (
          <X size={13} strokeWidth={1.5} className="size-3.5 shrink-0 text-(--color-tool-err)" aria-hidden />
        ) : (
          <Check size={13} strokeWidth={1.5} className="size-3.5 shrink-0 text-(--color-tool-ok)" aria-hidden />
        )}
        <ChevronRight
          size={14}
          aria-hidden
          className={`size-3.5 shrink-0 text-(--color-faint) transition-[transform] duration-(--duration-fast) ease-(--ease-smooth-out) motion-reduce:transition-none ${
            open ? "rotate-90" : ""
          }`}
        />
      </button>
      <div className="acc-panel" data-open={open}>
        <div className="acc-panel-inner">
          <div className="space-y-2 pt-2">
            {tool.result ? (
              <pre
                className={`scrollbar-thin max-h-60 overflow-auto rounded-md p-2 font-mono code-text whitespace-pre ${
                  tool.isError ? "bg-(--color-tool-err)/10 text-(--color-tool-err)" : "bg-(--color-surface) text-(--color-foreground)"
                }`}
              >
                {tool.result}
              </pre>
            ) : !tool.done ? (
              <div className="h-6 animate-pulse rounded-md bg-(--color-surface)" />
            ) : (
              <div className="text-(--color-faint)">{t("tool.status.empty")}</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function RunToolRows({ t, tools }: { t: (key: string) => string; tools: SubagentRun["tools"] }): React.JSX.Element {
  const rows = pairedRunTools(tools);
  return (
    <div className="flex flex-col gap-4">
      {rows.map((tool, index) => (
        <RunToolRow key={index} t={t} tool={tool} />
      ))}
    </div>
  );
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

/** 对话视图：选中运行的完整对话——prompt、子工具轨迹、Markdown 正文（运行中
 *  流式增长，外观设置的高亮主题对经 code 传入）、错误块与时间戳。 */
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
  // 运行中且用户贴底（<48px）时保持钉底，上滚即释放——与时间线同规则。
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !running) return;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 48) el.scrollTop = el.scrollHeight;
  }, [running, run.text, run.final, run.tools.length]);
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
      <div ref={scrollRef} className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
        {/* 消息渲染与主聊天同语言：prompt = 用户气泡（右对齐、3px 尾角），
            工具轨迹 = 扁平工具行（动词 + 参数摘要、可展开结果摘录），
            正文 = Markdown 帧（运行中流式光标），错误 = ⚠ 前缀正文行。 */}
        <div className="space-y-5 px-3 py-4">
          {run.prompt && (
            <div className="flex justify-end">
              <div className="max-w-[85%] rounded-xl rounded-tr-[2px] border border-(--color-border) bg-(--color-surface) px-4 py-3 leading-relaxed whitespace-pre-wrap break-words text-(--color-foreground)">
                {run.prompt}
              </div>
            </div>
          )}
          {run.tools.length > 0 && <RunToolRows t={t} tools={run.tools} />}
          {body && (
            <div className="min-h-6">
              <MarkdownView source={body} animated={running} code={code} />
              {running && <span className="stream-caret" aria-hidden />}
            </div>
          )}
          {!body && running && (
            <div className="flex items-center gap-1.5 text-(--color-faint)">
              <span className="inline-block size-3 animate-spin rounded-full border border-(--color-border) border-t-(--color-foreground)" />
              {t("chat.thinking.live")}
            </div>
          )}
          {run.error && <div className="leading-relaxed break-words text-(--color-foreground)">⚠ {run.error}</div>}
          <time className="block select-none text-[12px] text-(--color-faint)" dateTime={stamp.toISOString()}>
            {stamp.toTimeString().slice(0, 5)}
          </time>
        </div>
      </div>
    </div>
  );
}

/** 列表视图整体（含空态）。 */
export function SubagentsList({
  t,
  runs,
  onOpen,
}: {
  t: (key: string) => string;
  runs: SubagentRun[];
  onOpen: (childId: string) => void;
}): React.JSX.Element {
  return (
    <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
      {runs.length === 0 ? (
        <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center text-(--color-faint)">
          <Bot size={22} strokeWidth={1.3} aria-hidden />
          <span className="text-[13px]">{t("dock.empty")}</span>
        </div>
      ) : (
        <div className="space-y-2.5 p-3">
          {runs.map((run) => (
            <RunCard key={run.childId} t={t} run={run} onOpen={() => onOpen(run.childId)} />
          ))}
        </div>
      )}
    </div>
  );
}
