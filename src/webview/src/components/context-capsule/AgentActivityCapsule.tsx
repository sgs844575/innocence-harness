import { ChevronDown, ChevronRight, CircleDot, GitBranch, GitCommitHorizontal, ListChecks, PanelRight, Play, SquareTerminal, Bot } from "lucide-react";
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
  environment: "环境信息 / Git",
  process: "进程",
  terminal: "终端",
  agent: "智能体",
};

function SectionButton({ section, expanded, detail, ...buttonProps }: { section: CapsuleSection; expanded: boolean; detail?: string } & ButtonHTMLAttributes<HTMLButtonElement>): React.JSX.Element {
  const Icon = section === "environment" ? GitBranch : section === "process" ? ListChecks : section === "terminal" ? SquareTerminal : Bot;
  return (
    <button {...buttonProps} type="button" aria-expanded={expanded} className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-[11px] text-(--color-app-muted) hover:bg-(--color-app-bubble)">
      <Icon size={13} className="shrink-0" />
      <span>{sectionLabel[section]}</span>
      {detail && <span className="truncate text-[10px] text-(--color-app-muted)">{detail}</span>}
      <ChevronRight size={12} className={`ml-auto shrink-0 transition-transform ${expanded ? "rotate-90" : ""}`} />
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
        <button type="button" onClick={onToggleOpen} className="flex w-full items-center gap-2 px-3 py-2 text-left text-[11px] text-(--color-app-text)">
          <CircleDot size={12} className="text-(--color-app-accent)" />
          <span className="truncate">{process?.current || agent.name}</span>
          <PanelRight size={13} className="ml-auto shrink-0 text-(--color-app-muted)" />
        </button>
      </aside>
    );
  }

  return (
    <aside className={className} aria-label="Agent 活动胶囊">
      <div className="flex items-center border-b border-(--color-app-hairline) px-3 py-2">
        <span className="text-[11px] font-medium text-(--color-app-text)">活动上下文</span>
        <button type="button" aria-label="折叠活动胶囊" onClick={onToggleOpen} className="ml-auto grid size-6 place-items-center rounded-full text-(--color-app-muted) hover:bg-(--color-app-bubble)">
          <ChevronDown size={13} />
        </button>
      </div>
      <div className="divide-y divide-(--color-app-hairline)">
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
                <div className="space-y-1 px-3 pb-3 text-[10.5px] text-(--color-app-muted)">
                  <div className="flex items-center justify-between rounded-md bg-(--color-app-bubble) px-2 py-1.5"><span><GitCommitHorizontal size={12} className="mr-1 inline" />变更 {environment.changedFiles}</span><span><b className="text-(--color-tool-ok)">+{environment.additions}</b> <b className="text-(--color-tool-err)">−{environment.deletions}</b></span></div>
                  <div className="flex items-center justify-between px-1 py-1"><span>工作区种类</span><span>{environment.workspaceKind}</span></div>
                  <div className="flex items-center justify-between px-1 py-1"><span><GitBranch size={12} className="mr-1 inline" />分支</span><span>{environment.branch ?? "未检测"}</span></div>
                  <div className="flex gap-1 pt-1">
                    <button type="button" disabled={!environment.onCommit} onClick={environment.onCommit} className="capsule-action"><GitCommitHorizontal size={11} />提交</button>
                    <button type="button" disabled={!environment.onPush} onClick={environment.onPush} className="capsule-action"><Play size={11} />推送</button>
                    <button type="button" disabled={!environment.onCompare} onClick={environment.onCompare} className="capsule-action">比较</button>
                  </div>
                </div>
              )}
              {section === "process" && process && <TodoPanel {...process} />}
              {section === "terminal" && terminal && <div className="flex items-center justify-between px-3 pb-3 text-[10.5px] text-(--color-app-muted)"><span>{terminalLabel}</span><button type="button" disabled={!terminal.onOpen} onClick={terminal.onOpen} className="capsule-action">打开终端</button></div>}
              {section === "agent" && (
                <div className="space-y-2 px-3 pb-3 text-[10.5px] text-(--color-app-muted)">
                  <div className="flex items-center gap-2"><Bot size={12} />{agent.name}<span className="ml-auto">{agent.status}</span></div>
                  {childAgents.map((child) => (
                    <button
                      key={child.childId}
                      type="button"
                      onClick={() => openChild?.(child.childId)}
                      className="flex w-full items-center gap-2 rounded-md bg-(--color-app-bubble) px-2 py-1.5 text-left hover:bg-(--color-app-bubble)/70"
                      disabled={!openChild}
                    >
                      <Bot size={11} className="shrink-0" />
                      <span className="min-w-0 flex-1 truncate">{child.description || "子智能体"}</span>
                      <span className="shrink-0">{child.status}</span>
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
