import { Bot, ChevronDown, ChevronRight, FilePlus2, GitBranch, GitCommitHorizontal, ListChecks, Minimize2, Play, SquareTerminal } from "lucide-react";
import type { ButtonHTMLAttributes } from "react";
import { CAPSULE_SECTION_ORDER, type CapsulePlacement, type CapsuleSection } from "../../state/workspacePresentationState";
import type { AgentActivityStatus, SubagentActivityView } from "./activityProjection";
import { Collapsible } from "../ui/Collapsible";
import { TodoPanel } from "../task/TodoPanel";

export { CAPSULE_SECTION_ORDER } from "../../state/workspacePresentationState";

export interface AgentActivityCapsuleProps {
  open: boolean;
  onToggleOpen: () => void;
  expandedSections: readonly CapsuleSection[];
  onToggleSection: (section: CapsuleSection) => void;
  environment?: {
    branch: string | null;
    changedFiles: number;
    additions: number;
    deletions: number;
    workspaceKind: string;
    onCommit?: () => void;
    onPush?: () => void;
    onCompare?: () => void;
  };
  process?: {
    todos?: readonly { content: string; status: "pending" | "in_progress" | "completed" }[];
    completed: number;
    total: number;
    current: string;
    pending: number;
    onOpen?: () => void;
  };
  terminal?: { durationMs: number; backgroundTasks: number; onOpen?: () => void };
  agent: { name: string; status: AgentActivityStatus };
  subagents?: readonly SubagentActivityView[];
  onOpenSubagent?: (childId: string) => void;
  placement: CapsulePlacement;
}

const sectionLabel: Record<CapsuleSection, string> = {
  environment: "Git 工具",
  process: "进程",
  terminal: "终端",
  agent: "智能体",
};

/** 参考稿 gp-row：26px 行、13px 文本、15px 图标、右侧簇；行距 11px。 */
const gpRow = "flex h-[26px] w-full items-center gap-[11px] text-left text-[13px] whitespace-nowrap text-(--color-app-text)";

function SectionButton({ section, expanded, detail, ...buttonProps }: { section: CapsuleSection; expanded: boolean; detail?: string } & ButtonHTMLAttributes<HTMLButtonElement>): React.JSX.Element {
  const Icon = section === "environment" ? GitBranch : section === "process" ? ListChecks : section === "terminal" ? SquareTerminal : Bot;
  return (
    <button {...buttonProps} type="button" aria-expanded={expanded} className={`${gpRow} mt-[11px] pr-1 text-(--color-app-muted) hover:text-(--color-app-text)`}>
      <Icon size={15} strokeWidth={1.1} className="shrink-0 text-(--color-app-muted)" />
      <span className="font-bold">{sectionLabel[section]}</span>
      {detail && <span className="truncate text-[12px] font-normal">{detail}</span>}
      <ChevronRight size={12} strokeWidth={1.3} className={`ml-auto shrink-0 text-(--color-app-muted) transition-transform ${expanded ? "rotate-90" : ""}`} />
    </button>
  );
}

export function AgentActivityCapsule({ open, onToggleOpen, expandedSections, onToggleSection, environment, process, terminal, agent, subagents, onOpenSubagent, placement }: AgentActivityCapsuleProps): React.JSX.Element {
  // 全部状态可见：completed/failed/cancelled 的子会话也要能点击回看，
  // 只保留传入顺序、不再按状态过滤。
  const childAgents = subagents ?? [];
  const openChild = onOpenSubagent;
  const expanded = (section: CapsuleSection) => expandedSections.includes(section);
  const terminalLabel = terminal ? `${formatDuration(terminal.durationMs)} · ${terminal.backgroundTasks} 后台` : "";
  const processLabel = process ? `${process.completed}/${process.total}` : "";
  const sections = CAPSULE_SECTION_ORDER.filter((section) => (
    section === "environment" ? environment !== undefined
      : section === "process" ? process !== undefined
        : section === "terminal" ? terminal !== undefined
          : true
  ));
  const className = placement === "docked"
    ? "agent-capsule agent-capsule-docked"
    : placement === "overlay"
      ? "agent-capsule agent-capsule-overlay"
      : "agent-capsule agent-capsule-sheet";

  if (!open) {
    const compactClass = placement === "docked" ? "" : " agent-capsule-collapsed-compact";
    return (
      <aside className={`${className} agent-capsule-collapsed${compactClass}`} aria-label="当前进程胶囊">
        <button type="button" onClick={onToggleOpen} className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] text-(--color-app-text)">
          <ListChecks size={13} className="text-(--color-app-accent)" />
          <span className="truncate">{process?.current || agent.name}</span>
          <ChevronDown size={13} className="ml-auto shrink-0 text-(--color-app-muted)" />
        </button>
      </aside>
    );
  }

  return (
    <aside className={className} aria-label="Agent 活动胶囊">
      <div className="flex h-[22px] items-center px-[18px] pt-[14px] text-[13px] font-bold text-(--color-app-text)">
        <span>活动上下文</span>
        <span className="ml-auto flex items-center gap-3.5 text-(--color-app-muted)">
          <button type="button" aria-label="折叠活动胶囊" onClick={onToggleOpen} className="grid size-5 place-items-center rounded hover:text-(--color-app-text)">
            <Minimize2 size={13} />
          </button>
        </span>
      </div>
      <div className="flex flex-col px-[18px] pb-[14px]">
        {sections.map((section) => {
          const isExpanded = expanded(section);
          return (
            <section key={section} data-testid={`capsule-section-${section}`} data-section={section}>
              <Collapsible
                open={isExpanded}
                onOpenChange={() => onToggleSection(section)}
                trigger={
                  <SectionButton
                    section={section}
                    expanded={isExpanded}
                    detail={section === "process" ? processLabel : section === "terminal" ? terminalLabel : undefined}
                  />
                }
              >
              {section === "environment" && environment && (
                <div className="pt-[6px] text-[13px] text-(--color-app-text)">
                  <div className={`${gpRow} mt-[5px]`}>
                    <FilePlus2 size={15} strokeWidth={1.1} className="shrink-0 text-(--color-app-muted)" />
                    <span>更改</span>
                    <span className="ml-auto flex items-center gap-2.5">
                      {environment.changedFiles > 0 && <span className="text-[12px] text-(--color-app-muted)">{environment.changedFiles} 文件</span>}
                      <span className="text-[12.5px] text-(--color-diff-add)">+{environment.additions}</span>
                      <span className="text-[12.5px] text-(--color-diff-del)">−{environment.deletions}</span>
                    </span>
                  </div>
                  <div className={`${gpRow} mt-[11px]`}>
                    <GitBranch size={15} strokeWidth={1.1} className="shrink-0 text-(--color-app-muted)" />
                    <span>分支</span>
                    <span className="ml-auto min-w-0 truncate text-[12.5px] text-(--color-app-muted)">{environment.branch ?? "未检测"}</span>
                  </div>
                  <div className={`${gpRow} mt-[11px]`}>
                    <GitCommitHorizontal size={15} strokeWidth={1.1} className="shrink-0 text-(--color-app-muted)" />
                    <span>提交或推送</span>
                    <span className="ml-auto flex items-center gap-2">
                      {environment.onCommit && <button type="button" onClick={environment.onCommit} className="capsule-action">提交</button>}
                      {environment.onPush && <button type="button" onClick={environment.onPush} className="capsule-action"><Play size={11} />推送</button>}
                      {environment.onCompare && <button type="button" onClick={environment.onCompare} className="capsule-action">比较</button>}
                    </span>
                  </div>
                  <div className="mt-[13px] h-px bg-(--color-app-hairline)" />
                  <div className="flex h-[26px] items-center gap-[38px] pt-[2px] text-[13px] text-(--color-app-muted)">
                    <span>工作区</span>
                    <span>{environment.workspaceKind}</span>
                  </div>
                </div>
              )}
              {section === "process" && process && <TodoPanel {...process} />}
              {section === "terminal" && terminal && (
                <div className="flex h-[26px] items-center justify-between pt-[2px] text-[12px] text-(--color-app-muted)">
                  <span>{terminalLabel}</span>
                  <button type="button" disabled={!terminal.onOpen} onClick={terminal.onOpen} className="capsule-action">打开终端</button>
                </div>
              )}
              {section === "agent" && (
                <div className="flex flex-col gap-[7px] pb-[4px] pt-[6px] text-[13px] text-(--color-app-muted)">
                  <div className="flex items-center gap-[11px]"><Bot size={13} />{agent.name}<span className="ml-auto text-[12px]">{statusLabel(agent.status)}</span></div>
                  {childAgents.map((child) => (
                    <button
                      key={child.childId}
                      type="button"
                      onClick={() => openChild?.(child.childId)}
                      className="flex w-full items-center gap-[11px] rounded-md px-1 py-1 text-left hover:bg-(--color-app-hover) hover:text-(--color-app-text)"
                      disabled={!openChild}
                    >
                      <Bot size={11} className="shrink-0" />
                      <span className="min-w-0 flex-1 truncate">{child.description || "子智能体"}</span>
                      <span className="shrink-0 text-[12px]">{statusLabel(child.status)}</span>
                    </button>
                  ))}
                </div>
              )}
              </Collapsible>
            </section>
          );
        })}
      </div>
    </aside>
  );
}

function formatDuration(durationMs: number): string {
  const seconds = Math.max(0, Math.floor(durationMs / 1000));
  return `${Math.floor(seconds / 60)}分 ${String(seconds % 60).padStart(2, "0")}秒`;
}

/** 状态枚举的中文标签（未知值原样透传，便于诊断新枚举漏配）。 */
const STATUS_LABELS: Record<string, string> = {
  idle: "空闲",
  running: "运行中",
  "waiting-permission": "等待权限",
  failed: "失败",
  archived: "已归档",
  started: "已启动",
  completed: "已完成",
  cancelled: "已取消",
};

function statusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status;
}
