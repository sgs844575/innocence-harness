// 浮动活动胶囊（参考界面右上卡）：319px、popup 底、12px 圆角，悬浮于聊天表面
// 右上（top/right 18px），不占布局列。默认不出现——本项目是 Git 仓库 / 已有待办
// 清单 / 调用过智能体 / 存在存活终端时任一成立才出现（capsuleHasContent 判定）。
// 头部 = 标题（Git 仓库显示「Git 工具」，否则「活动」）+ 折叠钮；Git 段直出
// （更改/分支/提交或推送，仅 Git 仓库；分支行是交互式分支选择器（面板同标题栏），
// 「提交或推送」行是交互式提交面板 CommitPopover：提交/提交并推送/推送 + AI 生成
// 提交信息，无桥/无回调时退化为禁用静态行）；进程段 = 待办清单（完成项划线）；
// 智能体段 = 只直出进行中运行行（两行：标题 + 「已运行」副标题，带暂停钮，点标题开右侧
// 对话；段标右侧带存活计数），已结束的全部收进「查看全部」归档；终端段为状态摘要行。
// 折叠后收成右缘图标小胶囊。开合切换：先播关闭再进场。
import { useEffect, useState } from "react";
import {
  Bot,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Circle,
  FilePlus2,
  GitBranch,
  GitCommitHorizontal,
  ListChecks,
  LoaderCircle,
  Minimize2,
  Pause,
  SquareTerminal,
} from "lucide-react";
import type { SubagentStatus } from "../../../shared/ipc";
import { hasBridge } from "../lib/ipc";
import { formatRunDuration } from "../state/subagentRuns";
import { BranchPickerPopover } from "./BranchPicker";
import { CommitPopover } from "./CommitPopover";
import type { TodoItem } from "./chat/toolRows";

/** 关闭动画时长，与 app.css `--duration-quick` 对齐。 */
const CAPSULE_CLOSE_MS = 150;

/** 胶囊里的单个子代理运行行（标题 = description，回退预设名/面板名）。 */
export interface CapsuleSubagentItem {
  childId: string;
  title: string;
  status: SubagentStatus;
  /** 运行开始时间：存活行副标题「已运行 mm:ss」的活值起点。 */
  startedAt: number;
}

export interface GitCapsuleData {
  branch: string | null;
  /** 当前项目是否为 Git 仓库（Git 段与整体可见性条件）。 */
  isGitRepo: boolean;
  /** 会话工作区根：存在且桥可用时分支行变为交互式分支选择器（同标题栏面板）。 */
  root?: string;
  /** 工作区 diff 统计；undefined = 未探测到（stagedFiles/unstagedFiles 供提交面板拆分显示）。 */
  changes?: { changedFiles: number; additions: number; deletions: number; stagedFiles?: number; unstagedFiles?: number };
  todos: TodoItem[];
  /** 本会话子代理运行：进行中（新→旧）直出带暂停钮；终态只计入「查看全部」。 */
  subagents?: { running: CapsuleSubagentItem[]; completed: CapsuleSubagentItem[] };
  /** 存活终端数（一个终端标签 = 一个存活 PTY）。 */
  terminals?: { count: number };
  /** 提交/推送成功后回调（驱动 Git 数据重拉）；缺省 = 「提交或推送」行禁用态。 */
  onCommitted?: () => void;
  /** 分支行检出成功后回调（驱动 Git 数据重拉）。 */
  onBranchSwitched?: (branch: string) => void;
  /** 分支操作错误回调。 */
  onError?: (message: string) => void;
  /** 分支面板「Git 图谱」入口：打开图谱对话框。 */
  onOpenGraph?: () => void;
  /** 点击运行行标题：右侧 dock 直达该子代理的会话记录。 */
  onOpenSubagentRun?: (childId: string) => void;
  /** 存活行的暂停钮：取消该子代理运行（终态经 lifecycle 事件回流）。 */
  onCancelSubagent?: (childId: string) => void;
  /** 「查看全部」行：右侧 dock 打开本会话子代理归档视图（终态列表）。 */
  onOpenSubagents?: () => void;
  /** 点击终端行：打开右侧 dock 并激活存活终端标签。 */
  onOpenTerminals?: () => void;
}

const row = "flex h-[26px] w-full items-center gap-[11px] text-left whitespace-nowrap text-(--color-foreground)";

/** 分支行：有 root + 桥时为交互式分支选择器（复用标题栏面板，行尾带下拉尖角）；
 *  否则退化为静态行。 */
function BranchRow({ t, data }: { t: (key: string) => string; data: GitCapsuleData }): React.JSX.Element {
  const label = data.branch ?? t("capsule.branch.unknown");
  const interactive = hasBridge() && !!data.root && !!data.onBranchSwitched && !!data.onError;
  if (!interactive) {
    return (
      <div className={`${row} mt-[11px]`}>
        <GitBranch size={15} strokeWidth={1.1} className="shrink-0 text-(--color-muted)" />
        <span className="min-w-0 truncate font-mono">{label}</span>
      </div>
    );
  }
  return (
    <BranchPickerPopover
      t={t}
      root={data.root!}
      current={data.branch}
      onSwitched={data.onBranchSwitched!}
      onError={data.onError!}
      onOpenGraph={data.onOpenGraph}
      side="left"
      align="start"
      trigger={
        <button type="button" title={label} className={`${row} mt-[11px] rounded-md outline-none hover:bg-(--color-hover) w-auto shrink-0`}>
          <GitBranch size={15} strokeWidth={1.1} className="shrink-0 text-(--color-muted)" />
          <span className="min-w-0 truncate font-mono">{label}</span>
          <ChevronDown size={12} className="ml-auto shrink-0 text-(--color-faint)" />
        </button>
      }
    />
  );
}
const divider = <div className="my-[11px] h-px bg-(--color-hairline)" />;

/** 「提交或推送」行：root + 桥 + 成功/错误回调齐备时为交互式提交面板（CommitPopover，
 *  行尾带下拉尖角）；否则退化为禁用静态行。 */
function CommitRow({ t, data }: { t: (key: string) => string; data: GitCapsuleData }): React.JSX.Element {
  const label = t("capsule.commitPush");
  const interactive = hasBridge() && !!data.root && !!data.onCommitted && !!data.onError;
  if (!interactive) {
    return (
      <div className={`${row} mt-[11px] opacity-45`}>
        <GitCommitHorizontal size={15} strokeWidth={1.1} className="shrink-0 text-(--color-muted)" />
        <button type="button" disabled title={label} className="hover:text-(--color-foreground) disabled:cursor-not-allowed">
          {label}
        </button>
      </div>
    );
  }
  return (
    <CommitPopover
      t={t}
      root={data.root!}
      branch={data.branch}
      changes={data.changes}
      onSwitched={data.onBranchSwitched ?? (() => {})}
      onCommitted={data.onCommitted!}
      onError={data.onError!}
      onOpenGraph={data.onOpenGraph}
      trigger={
        <button type="button" title={label} className={`${row} mt-[11px] rounded-md outline-none hover:bg-(--color-hover) w-auto shrink-0`}>
          <GitCommitHorizontal size={15} strokeWidth={1.1} className="shrink-0 text-(--color-muted)" />
          <span>{label}</span>
          <ChevronDown size={12} className="ml-auto shrink-0 text-(--color-faint)" />
        </button>
      }
    />
  );
}
/** 段标题（智能体/终端上方的小字标签）。 */
const sectionLabel = "mb-[6px] text-(--color-faint)";
/** 摘要行卡：raised 底、可点击（hover 提亮），右侧计数 + 尖括号。 */
const summaryRow =
  "flex h-8 w-full items-center gap-[11px] rounded-lg bg-(--color-raised) px-2.5 text-left whitespace-nowrap text-(--color-foreground) transition-colors hover:bg-(--color-hover)";
/** 智能体运行行：标题 + 「已运行」副标题两行，hover 提亮（与摘要行同节奏但无卡底）。 */
const runRow =
  "mb-[2px] flex w-full items-start gap-2 rounded-md px-1.5 py-1 text-left text-(--color-foreground) transition-colors hover:bg-(--color-hover)";

export function GitCapsule({
  t,
  data,
  open,
  onToggleOpen,
}: {
  t: (key: string) => string;
  data: GitCapsuleData;
  /** 开合受控（挤压布局需要感知胶囊尺寸）。 */
  open: boolean;
  onToggleOpen: (open: boolean) => void;
}): React.JSX.Element {
  const [processOpen, setProcessOpen] = useState(true);
  // 开合过渡：open 变化时先把当前形态播关闭动画（data-state=closed），再换挂新形态。
  const [phase, setPhase] = useState<"panel" | "chip">(open ? "panel" : "chip");
  const [closing, setClosing] = useState(false);
  // 存活子代理行的「已运行」副标题活值：有存活运行时每秒走一次，无则停表。
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const target = open ? "panel" : "chip";
    if (target === phase) return;
    setClosing(true);
    const timer = setTimeout(() => {
      setPhase(target);
      setClosing(false);
    }, CAPSULE_CLOSE_MS);
    return () => clearTimeout(timer);
  }, [open, phase]);
  const state = closing ? "closed" : "open";
  const done = data.todos.filter((todo) => todo.status === "completed").length;

  const showProcess = data.todos.length > 0;
  const subagentRunning = data.subagents?.running ?? [];
  const subagentCompleted = data.subagents?.completed ?? [];
  const showSubagents = subagentRunning.length + subagentCompleted.length > 0;
  const showTerminals = (data.terminals?.count ?? 0) > 0;

  useEffect(() => {
    if (subagentRunning.length === 0) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [subagentRunning.length]);

  if (phase === "chip") {
    // 折叠态（参考规格）：有更改数据时收成「更改 +N −M」紧凑芯片，否则图标小圆钮。
    if (data.changes) {
      return (
        <button
          type="button"
          aria-label={t("capsule.expand")}
          title={t("capsule.expand")}
          onClick={() => onToggleOpen(true)}
          className="dropdown-in origin-top-right absolute top-[18px] right-[18px] z-10 flex h-8 items-center gap-2 rounded-full border border-(--color-border) bg-(--color-popup) px-3 text-(--color-muted) shadow-(--shadow-pop) hover:text-(--color-foreground)"
          data-state={state}
        >
          <FilePlus2 size={14} strokeWidth={1.1} />
          <span>{t("capsule.changes")}</span>
          <span className="font-mono leading-none tabular-nums">
            <span className="text-(--color-diff-add)">+{data.changes.additions}</span>{" "}
            <span className="text-(--color-diff-del)">−{data.changes.deletions}</span>
          </span>
        </button>
      );
    }
    return (
      <button
        type="button"
        aria-label={t("capsule.expand")}
        title={t("capsule.expand")}
        onClick={() => onToggleOpen(true)}
        className="dropdown-in origin-top-right absolute top-[18px] right-[18px] z-10 grid size-8 place-items-center rounded-full border border-(--color-border) bg-(--color-popup) text-(--color-muted) shadow-(--shadow-pop) hover:text-(--color-foreground)"
        data-state={state}
      >
        <ListChecks size={14} />
      </button>
    );
  }

  return (
    <aside
      aria-label={t("capsule.git")}
      data-state={state}
      className="dropdown-in origin-top-right absolute top-[18px] right-[18px] z-10 w-[319px] rounded-(--radius-pop) border border-(--color-border) bg-(--color-popup) shadow-(--shadow-pop)"
    >
      <div className="flex items-center px-[18px] pt-[14px] pb-2 font-bold text-(--color-foreground)">
        <span>{data.isGitRepo ? t("capsule.git") : t("capsule.activity")}</span>
        <button
          type="button"
          aria-label={t("capsule.collapse")}
          title={t("capsule.collapse")}
          onClick={() => onToggleOpen(false)}
          className="ml-auto grid size-7 place-items-center rounded-md text-(--color-muted) hover:bg-(--color-hover) hover:text-(--color-foreground)"
        >
          <Minimize2 size={13} />
        </button>
      </div>
      <div className="flex flex-col px-[18px] pb-[16px]">
        {data.isGitRepo && (
          <>
            {data.changes && (
              <div className={row}>
                <FilePlus2 size={15} strokeWidth={1.1} className="shrink-0 text-(--color-muted)" />
                <span>{t("capsule.changes")}</span>
                <span className="ml-auto font-mono">
                  <span className="text-(--color-diff-add)">+{data.changes.additions}</span>{" "}
                  <span className="text-(--color-diff-del)">−{data.changes.deletions}</span>
                </span>
              </div>
            )}
            <BranchRow t={t} data={data} />
            <CommitRow t={t} data={data} />
          </>
        )}

        {showProcess && (
          <>
            {data.isGitRepo && divider}
            <button
              type="button"
              aria-expanded={processOpen}
              title={t("capsule.process")}
              onClick={() => setProcessOpen((value) => !value)}
              className={`${row} text-(--color-muted) hover:text-(--color-foreground)`}
            >
              <ChevronRight size={12} className={`transition-transform motion-reduce:transition-none ${processOpen ? "rotate-90" : ""}`} />
              <span>{t("capsule.process")}</span>
              <span className="ml-auto font-mono text-(--color-tool-ok)">
                {done}/{data.todos.length}
              </span>
            </button>
            <div className="acc-panel" data-open={processOpen}>
              <div className="acc-panel-inner">
                <ul className="mt-[6px] space-y-[6px]">
                  {data.todos.map((todo, index) => (
                    <li key={index} className="flex items-center gap-2 text-(--color-muted)">
                      {todo.status === "completed" ? (
                        <CheckCircle2 size={13} className="shrink-0 text-(--color-tool-ok)" />
                      ) : todo.status === "in_progress" ? (
                        <LoaderCircle size={13} className="shrink-0 animate-spin text-(--color-accent)" />
                      ) : (
                        <Circle size={13} className="shrink-0 text-(--color-faint)" />
                      )}
                      <span className={`truncate ${todo.status === "completed" ? "line-through opacity-60" : ""}`}>
                        {todo.content}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </>
        )}

        {showSubagents && (
          <>
            {(data.isGitRepo || showProcess) && divider}
            <div className={`${sectionLabel} flex items-center`}>
              <span>{t("capsule.subagents")}</span>
              {subagentRunning.length > 0 && (
                <span className="ml-auto font-mono tabular-nums">
                  {subagentRunning.length} {t("capsule.subagents.running")}
                </span>
              )}
            </div>
            {/* 存活行在上：转圈 + 两行文本（标题点开对话 / 「已运行」副标题）+ 暂停钮（取消该运行）。 */}
            {subagentRunning.map((item) => (
              <div key={item.childId} className={runRow}>
                <LoaderCircle size={13} strokeWidth={1.5} className="mt-[3px] shrink-0 animate-spin text-(--color-accent)" aria-hidden />
                <button
                  type="button"
                  onClick={() => data.onOpenSubagentRun?.(item.childId)}
                  title={item.title}
                  className="min-w-0 flex-1 text-left"
                >
                  <span className="block truncate">{item.title}</span>
                  <span className="block text-[12px] text-(--color-faint)">
                    {t("capsule.subagents.elapsed")}{" "}
                    <span className="font-mono tabular-nums">{formatRunDuration(item.startedAt, now)}</span>
                  </span>
                </button>
                {data.onCancelSubagent && (
                  <button
                    type="button"
                    onClick={() => data.onCancelSubagent?.(item.childId)}
                    aria-label={t("capsule.subagents.pause")}
                    title={t("capsule.subagents.pause")}
                    className="mt-[1px] grid size-6 shrink-0 place-items-center rounded-md text-(--color-muted) hover:bg-(--color-hover) hover:text-(--color-foreground)"
                  >
                    <Pause size={12} strokeWidth={1.5} />
                  </button>
                )}
              </div>
            ))}
            {/* 「查看全部 N ›」：已结束运行不直出，全部收进归档（N = 终态数）。 */}
            {subagentCompleted.length > 0 && (
              <button
                type="button"
                onClick={data.onOpenSubagents}
                title={t("capsule.subagents.openList")}
                className={`${summaryRow} mt-[4px]`}
              >
                <Bot size={13} strokeWidth={1.5} className="shrink-0 text-(--color-muted)" />
                <span>{t("capsule.subagents.all")}</span>
                <span className="ml-auto font-mono text-(--color-muted)">
                  {subagentCompleted.length}
                </span>
                <ChevronRight size={12} className="shrink-0 text-(--color-faint)" />
              </button>
            )}
          </>
        )}

        {showTerminals && (
          <>
            {(data.isGitRepo || showProcess || showSubagents) && divider}
            <div className={sectionLabel}>{t("capsule.terminals")}</div>
            <button
              type="button"
              onClick={data.onOpenTerminals}
              title={t("capsule.terminals.open")}
              className={summaryRow}
            >
              <SquareTerminal size={13} className="shrink-0 text-(--color-muted)" />
              <span>{t("capsule.terminals.running")}</span>
              <span className="ml-auto font-mono text-(--color-muted)">{data.terminals?.count}</span>
              <ChevronRight size={12} className="shrink-0 text-(--color-faint)" />
            </button>
          </>
        )}
      </div>
    </aside>
  );
}
