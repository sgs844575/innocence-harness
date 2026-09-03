// 浮动活动胶囊（参考界面右上卡）：319px、popup 底、12px 圆角，悬浮于聊天表面
// 右上（top/right 18px），不占布局列。默认不出现——本项目是 Git 仓库 / 已有待办
// 清单 / 调用过智能体 / 存在存活终端时任一成立才出现（capsuleHasContent 判定）。
// 头部 = 标题（Git 仓库显示「Git 工具」，否则「活动」）+ 折叠钮；Git 段直出
// （更改/分支/提交或推送，仅 Git 仓库）；进程段 = 待办清单（完成项划线）；
// 智能体段 = 逐运行行（存活在上带暂停钮、已结束在下，点标题开右侧对话，
// 「查看全部」进本会话子代理列表）；终端段为状态摘要行。
// 折叠后收成右缘图标小胶囊。开合切换：先播关闭再进场。
import { useEffect, useState } from "react";
import {
  Bot,
  CheckCircle2,
  ChevronRight,
  Circle,
  CircleCheck,
  CircleSlash,
  CircleX,
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
import type { TodoItem } from "./chat/toolRows";

/** 关闭动画时长，与 app.css `--duration-quick` 对齐。 */
const CAPSULE_CLOSE_MS = 150;
/** 胶囊内已结束运行最多直出行数（其余经「查看全部」进列表）。 */
const CAPSULE_COMPLETED_ROWS = 2;

/** 胶囊里的单个子代理运行行（标题 = description，回退预设名/面板名）。 */
export interface CapsuleSubagentItem {
  childId: string;
  title: string;
  status: SubagentStatus;
}

export interface GitCapsuleData {
  branch: string | null;
  /** 当前项目是否为 Git 仓库（Git 段与整体可见性条件）。 */
  isGitRepo: boolean;
  /** 工作区 diff 统计；undefined = 未探测到。 */
  changes?: { changedFiles: number; additions: number; deletions: number };
  todos: TodoItem[];
  /** 本会话子代理运行：存活（新→旧）直出带暂停钮，已结束（新→旧）直出前几条。 */
  subagents?: { running: CapsuleSubagentItem[]; completed: CapsuleSubagentItem[] };
  /** 存活终端数（一个终端标签 = 一个存活 PTY）。 */
  terminals?: { count: number };
  /** 提交/推送入口（无后端时缺省 = 禁用态）。 */
  onCommitPush?: () => void;
  /** 点击运行行标题：右侧 dock 直达该子代理的会话记录。 */
  onOpenSubagentRun?: (childId: string) => void;
  /** 存活行的暂停钮：取消该子代理运行（终态经 lifecycle 事件回流）。 */
  onCancelSubagent?: (childId: string) => void;
  /** 「查看全部」行：右侧 dock 打开本会话子代理列表（存活/已完成分组）。 */
  onOpenSubagents?: () => void;
  /** 点击终端行：打开右侧 dock 并激活存活终端标签。 */
  onOpenTerminals?: () => void;
}

const row = "flex h-[26px] w-full items-center gap-[11px] text-left whitespace-nowrap text-(--color-foreground)";
const divider = <div className="my-[11px] h-px bg-(--color-hairline)" />;
/** 段标题（智能体/终端上方的小字标签）。 */
const sectionLabel = "mb-[6px] text-(--color-faint)";
/** 摘要行卡：raised 底、可点击（hover 提亮），右侧计数 + 尖括号。 */
const summaryRow =
  "flex h-8 w-full items-center gap-[11px] rounded-lg bg-(--color-raised) px-2.5 text-left whitespace-nowrap text-(--color-foreground) transition-colors hover:bg-(--color-hover)";
/** 智能体运行行：标题可截断，hover 提亮（与摘要行同节奏但无卡底）。 */
const runRow =
  "flex h-[26px] w-full items-center gap-2 rounded-md px-1.5 text-left whitespace-nowrap text-(--color-foreground) transition-colors hover:bg-(--color-hover)";

/** 运行行状态图标（与 dock 子代理列表同一语义：绿完成/红失败/灰取消/转圈存活）。 */
function capsuleRunIcon(status: SubagentStatus): React.JSX.Element {
  if (status === "failed")
    return <CircleX size={13} strokeWidth={1.5} className="shrink-0 text-(--color-tool-err)" aria-hidden />;
  if (status === "cancelled")
    return <CircleSlash size={13} strokeWidth={1.5} className="shrink-0 text-(--color-faint)" aria-hidden />;
  if (status === "completed")
    return <CircleCheck size={13} strokeWidth={1.5} className="shrink-0 text-(--color-tool-ok)" aria-hidden />;
  return <LoaderCircle size={13} strokeWidth={1.5} className="shrink-0 animate-spin text-(--color-accent)" aria-hidden />;
}

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
            <div className={`${row} mt-[11px]`}>
              <GitBranch size={15} strokeWidth={1.1} className="shrink-0 text-(--color-muted)" />
              <span className="min-w-0 truncate font-mono">{data.branch ?? t("capsule.branch.unknown")}</span>
            </div>
            <div className={`${row} mt-[11px] ${data.onCommitPush ? "" : "opacity-45"}`}>
              <GitCommitHorizontal size={15} strokeWidth={1.1} className="shrink-0 text-(--color-muted)" />
              <button
                type="button"
                disabled={!data.onCommitPush}
                onClick={data.onCommitPush}
                title={t("capsule.commitPush")}
                className="hover:text-(--color-foreground) disabled:cursor-not-allowed"
              >
                {t("capsule.commitPush")}
              </button>
            </div>
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
            <div className={sectionLabel}>{t("capsule.subagents")}</div>
            {/* 存活行在上：转圈 + 标题（点开对话） + 暂停钮（取消该运行）。 */}
            {subagentRunning.map((item) => (
              <div key={item.childId} className={`${runRow} mb-[2px]`}>
                <LoaderCircle size={13} strokeWidth={1.5} className="shrink-0 animate-spin text-(--color-accent)" aria-hidden />
                <button
                  type="button"
                  onClick={() => data.onOpenSubagentRun?.(item.childId)}
                  title={item.title}
                  className="min-w-0 flex-1 truncate"
                >
                  {item.title}
                </button>
                {data.onCancelSubagent && (
                  <button
                    type="button"
                    onClick={() => data.onCancelSubagent?.(item.childId)}
                    aria-label={t("capsule.subagents.pause")}
                    title={t("capsule.subagents.pause")}
                    className="grid size-6 shrink-0 place-items-center rounded-md text-(--color-muted) hover:bg-(--color-hover) hover:text-(--color-foreground)"
                  >
                    <Pause size={12} strokeWidth={1.5} />
                  </button>
                )}
              </div>
            ))}
            {/* 已结束行在下（最多直出两条，其余进列表）：状态图标 + 标题。 */}
            {subagentCompleted.slice(0, CAPSULE_COMPLETED_ROWS).map((item) => (
              <button
                key={item.childId}
                type="button"
                onClick={() => data.onOpenSubagentRun?.(item.childId)}
                title={item.title}
                className={`${runRow} mb-[2px] text-(--color-muted) hover:text-(--color-foreground)`}
              >
                {capsuleRunIcon(item.status)}
                <span className="min-w-0 flex-1 truncate">{item.title}</span>
                <ChevronRight size={12} className="shrink-0 text-(--color-faint)" />
              </button>
            ))}
            {/* 「查看全部 N ›」：进入本会话子代理列表（存活/已完成分组，倒序）。 */}
            <button
              type="button"
              onClick={data.onOpenSubagents}
              title={t("capsule.subagents.openList")}
              className={`${summaryRow} mt-[4px]`}
            >
              <Bot size={13} strokeWidth={1.5} className="shrink-0 text-(--color-muted)" />
              <span>{t("capsule.subagents.all")}</span>
              <span className="ml-auto font-mono text-(--color-muted)">
                {subagentRunning.length + subagentCompleted.length}
              </span>
              <ChevronRight size={12} className="shrink-0 text-(--color-faint)" />
            </button>
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
