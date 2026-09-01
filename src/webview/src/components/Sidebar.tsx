// Sidebar navigation: durable trees, explicit id-only drag commands, and archive recovery.
// 呈现遵循参考稿：菜单块（新建/搜索/自动化/插件市场，带快捷键注记）；
// 分组/项目分类芯片 + 筛选/归档工具；运行任务条（星芒旋转）；
// 底部身份条（logo 头像 + 应用名 + 本地徽章 + 设置）。
// 顶部 logo/前进后退/新会话在标题栏左段（独立于侧栏，收起后仍保留）。
import { useMemo, useRef, useState } from "react";
import { DndContext, closestCenter, useDroppable, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  Archive,
  ArchiveRestore,
  Asterisk,
  ChevronRight,
  CircleAlert,
  CirclePlus,
  Filter,
  GripVertical,
  LayoutGrid,
  Pin,
  Search,
  Settings,
  ShieldAlert,
  Workflow,
  X,
} from "lucide-react";
import logoUrl from "../../../../logo.svg";
import type { Session } from "../../../shared/ipc";
import type { SidebarStateController } from "../state/useSidebarState";
import { resolveSidebarDrag } from "./sidebar/dnd";
import { buildSidebarTree, type SidebarTreeNode, type SidebarView } from "./sidebar/viewModel";

import type { SessionActivityStatus } from "../state/sessionActivityProjection";

export type SidebarSessionStatus = SessionActivityStatus;

interface Props {
  t: (key: string) => string;
  appName: string;
  sessions: Session[];
  activeId: string | null;
  sessionStatuses?: ReadonlyMap<string, SidebarSessionStatus>;
  sidebar: SidebarStateController;
  onSelect: (id: string) => void;
  onNew: () => void;
  onNewInGroup?: (groupId: string) => void;
  onDelete: (id: string) => void;
  onArchive: (id: string) => void;
  onOpenSettings: () => void;
  onSearch?: () => void;
  onAutomation?: () => void;
  onPlugins?: () => void;
  view?: SidebarView;
  collapsedProjectIds?: readonly string[];
  onViewChange?: (view: SidebarView) => void;
  onToggleProject?: (projectId: string) => void;
}

const NAV_ITEMS: readonly {
  icon: typeof CirclePlus;
  key: string;
  action: "new" | "search" | "automation" | "plugins";
  kbd?: string;
}[] = [
  { icon: CirclePlus, key: "sidebar.nav.newChat", action: "new", kbd: "Ctrl+N" },
  { icon: Search, key: "sidebar.nav.search", action: "search", kbd: "Ctrl+K" },
  { icon: Workflow, key: "sidebar.nav.automation", action: "automation" },
  { icon: LayoutGrid, key: "sidebar.nav.plugins", action: "plugins" },
];

export function Sidebar({ t, appName, sessions, activeId, sessionStatuses = new Map(), sidebar, onSelect, onNew, onNewInGroup, onDelete, onArchive, onOpenSettings, onSearch, onAutomation, onPlugins, view: controlledView, collapsedProjectIds = [], onViewChange, onToggleProject }: Props): React.JSX.Element {
  const [query, setQuery] = useState("");
  const [uncontrolledView, setUncontrolledView] = useState<SidebarView>("projects");
  const view = controlledView ?? uncontrolledView;
  const setView = (next: SidebarView) => {
    onViewChange?.(next);
    if (controlledView === undefined) setUncontrolledView(next);
  };
  const [archivedExpanded, setArchivedExpanded] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [groupDialogOpen, setGroupDialogOpen] = useState(false);
  const filterRef = useRef<HTMLInputElement>(null);
  const filterActive = query.trim().length > 0;
  const filtered = useMemo(() => filterActive ? sessions.filter((session) => session.title.toLowerCase().includes(query.trim().toLowerCase())) : sessions, [sessions, query, filterActive]);
  const tree = useMemo(() => buildSidebarTree(filtered, sidebar.state, view, t("sidebar.noProject"), collapsedProjectIds), [filtered, sidebar.state, t, view, collapsedProjectIds]);
  const byId = useMemo(() => new Map(sessions.map((session) => [session.id, session])), [sessions]);
  const archivedSessions = useMemo(() => sidebar.state.order.map((id) => byId.get(id)).filter((session): session is Session => session !== undefined && sidebar.state.archived[session.id] === true), [sidebar.state, byId]);
  const headerIds = useMemo(() => tree.filter((node) => node.kind !== "ungrouped").map((node) => `header:${node.id}`), [tree]);
  // 运行任务条：优先当前选中会话，否则取任一运行中的会话（多任务并行时
  // 展示第一条，完整清单仍在树内各自标注状态）。
  const runningSession = useMemo(
    () => sessions.find((session) => session.id === activeId && sessionStatuses.get(session.id) === "running")
      ?? sessions.find((session) => sessionStatuses.get(session.id) === "running"),
    [sessions, activeId, sessionStatuses],
  );

  const onDragEnd = (event: DragEndEvent) => {
    if (!event.over) return;
    const command = resolveSidebarDrag(sidebar.state, view, String(event.active.id), String(event.over.id), filterActive);
    if (!command) return;
    if (command.type === "move-session") void sidebar.moveSession(command.id, command.target, command.beforeId);
    else void sidebar.reorderContainers(command.kind, command.orderedIds);
  };

  const actionFor = (action: (typeof NAV_ITEMS)[number]["action"]): (() => void) | undefined => {
    if (action === "new") return onNew;
    if (action === "search") return onSearch ?? (() => filterRef.current?.focus());
    if (action === "automation") return onAutomation;
    return onPlugins ?? onOpenSettings;
  };

  const viewLabel = view === "groups" ? t("sidebar.groups") : t("sidebar.projects");

  return (
    <aside className="flex h-full w-full flex-col overflow-hidden">
      {/* 菜单块 */}
      <nav className="flex flex-col gap-px px-2.5 pt-3.5">
        {NAV_ITEMS.map(({ icon: Icon, key, action, kbd }) => <button key={key} type="button" onClick={actionFor(action)} title={t(key)} className="flex h-9 items-center gap-2.5 rounded-md px-2.5 text-left text-(--color-app-text) hover:bg-(--color-app-hover)"><Icon size={16} className="text-(--color-app-muted)" />{t(key)}{kbd && <span aria-hidden className="ml-auto text-(--color-app-faint)">{kbd}</span>}</button>)}
      </nav>

      {/* 分类芯片 + 筛选/归档工具 */}
      <div className="flex items-center gap-1 px-3.5 pt-3">
        <button type="button" onClick={() => setView("groups")} aria-pressed={view === "groups"} className={`flex h-[26px] items-center gap-1.5 rounded-full px-2.5 ${view === "groups" ? "bg-(--color-app-panel) font-medium text-(--color-app-text)" : "text-(--color-app-muted) hover:text-(--color-app-text)"}`}>{t("sidebar.groups")}</button>
        <button type="button" onClick={() => setView("projects")} aria-pressed={view === "projects"} className={`flex h-[26px] items-center gap-1.5 rounded-full px-2.5 ${view === "projects" ? "bg-(--color-app-panel) font-medium text-(--color-app-text)" : "text-(--color-app-muted) hover:text-(--color-app-text)"}`}>{t("sidebar.projects")}</button>
        {view === "projects" && <Pin size={13} className="ml-0.5 text-(--color-app-faint)" aria-hidden />}
        <div className="ml-auto flex items-center gap-3.5 text-(--color-app-muted)">
          <button type="button" aria-label={t("sidebar.filter")} title={t("sidebar.filter")} onClick={() => filterRef.current?.focus()} className="hover:text-(--color-app-text)"><Filter size={14} /></button>
          <button type="button" aria-label="归档列表" title="归档列表" onClick={() => setArchivedExpanded((v) => !v)} aria-expanded={archivedExpanded} className="hover:text-(--color-app-text)"><Archive size={14} /></button>
        </div>
      </div>

      {/* 运行任务条 */}
      {runningSession && (
        <button type="button" onClick={() => onSelect(runningSession.id)} title={runningSession.title} className="relative mx-2.5 mt-3.5 flex h-8 items-center gap-2.5 overflow-hidden rounded-[9px] bg-(--color-app-hover) pr-2.5 pl-2.5 text-left whitespace-nowrap text-(--color-app-text)">
          <Asterisk size={15} className="burst-spin shrink-0 text-(--color-app-muted)" />
          <span className="min-w-0 flex-1 truncate">{runningSession.title}</span>
          <span className="shrink-0 text-(--color-app-muted)">刚刚</span>
        </button>
      )}

      <div className="scrollbar-thin flex-1 overflow-y-auto px-2 pt-1">
        <div className="px-1.5 pt-3 pb-1 text-(--color-app-faint)">{viewLabel}</div>
        {view === "groups" && <div className="mb-1">
          <button type="button" onClick={() => setGroupDialogOpen(true)} className="w-full rounded-md border border-dashed border-(--color-app-border) px-2 py-1.5 text-left text-(--color-app-muted) hover:bg-(--color-app-hover) hover:text-(--color-app-text)">新建分组</button>
          {groupDialogOpen && <form className="mt-1 flex gap-1" onSubmit={(event) => {
            event.preventDefault();
            const name = newGroupName.trim();
            if (!name) return;
            void sidebar.upsertSidebarGroup({ id: `group_${Date.now().toString(36)}`, name, collapsed: false, sessionIds: [] });
            setNewGroupName("");
            setGroupDialogOpen(false);
          }}>
            <input aria-label="分组名称" autoFocus value={newGroupName} onChange={(event) => setNewGroupName(event.target.value)} className="min-w-0 flex-1 rounded-md border border-(--color-app-border) bg-(--color-app-panel) px-2 py-1 outline-none focus:border-(--color-app-accent)" />
            <button type="submit" aria-label="保存分组" disabled={!newGroupName.trim()} className="rounded-md bg-(--color-app-accent) px-2 py-1 text-(--color-app-accent-fg) disabled:opacity-40">保存</button>
          </form>}
        </div>}
        <input ref={filterRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("sidebar.filter")} className="mb-2 w-full rounded-md border border-transparent bg-(--color-app-sunken) px-3 py-1.5 outline-none placeholder:text-(--color-app-faint) focus:border-(--color-app-accent)" />
        <DndContext collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={headerIds} strategy={verticalListSortingStrategy}>
            {tree.map((node) => <TreeNode key={node.id} node={node} sessions={byId} archived={sidebar.state.archived} activeId={activeId} statuses={sessionStatuses} onSelect={onSelect} onNew={onNew} onNewInGroup={onNewInGroup} onDelete={onDelete} onArchive={onArchive} onCollapse={(collapsed) => node.kind === "group" ? void sidebar.setSidebarGroupCollapsed(node.id, collapsed) : onToggleProject?.(node.id)} dndDisabled={filterActive} deleteLabel={t("sidebar.delete")} />)}
          </SortableContext>
        </DndContext>
        {tree.length === 0 && <div className="px-2 py-3 text-center text-(--color-app-muted)">{t("sidebar.empty")}</div>}
        <ArchivedSection expanded={archivedExpanded} sessions={archivedSessions} activeId={activeId} onSelect={onSelect} onRestore={(id) => onArchive(id)} onDelete={onDelete} onToggle={() => setArchivedExpanded((value) => !value)} deleteLabel={t("sidebar.delete")} />
      </div>

      {/* side-bottom：身份条 */}
      <footer className="mt-auto flex shrink-0 items-center gap-2.5 px-4 pb-4 pt-2">
        <div className="grid size-8 shrink-0 place-items-center rounded-full bg-(--color-app-bg)">
          <img src={logoUrl} alt="" className="size-[15px] rounded-[3px]" />
        </div>
        <span className="min-w-0 truncate font-bold text-(--color-app-strong)">{appName}</span>
        <span className="shrink-0 rounded-full bg-(--color-app-bg) px-1.5 py-0.5 leading-none text-(--color-app-muted)">{t("sidebar.localMode")}</span>
        <div className="ml-auto">
          <button type="button" onClick={onOpenSettings} aria-label={t("sidebar.settings")} className="grid size-7 place-items-center rounded-md text-(--color-app-muted) hover:bg-(--color-app-hover) hover:text-(--color-app-text)"><Settings size={15} /></button>
        </div>
      </footer>
    </aside>
  );
}

function TreeNode({ node, sessions, archived, activeId, statuses, onSelect, onNew, onNewInGroup, onDelete, onArchive, onCollapse, dndDisabled, deleteLabel }: { node: SidebarTreeNode; sessions: ReadonlyMap<string, Session>; archived: Readonly<Record<string, boolean>>; activeId: string | null; statuses: ReadonlyMap<string, SidebarSessionStatus>; onSelect: (id: string) => void; onNew: () => void; onNewInGroup?: (groupId: string) => void; onDelete: (id: string) => void; onArchive: (id: string) => void; onCollapse: (collapsed: boolean) => void; dndDisabled: boolean; deleteLabel: string }): React.JSX.Element {
  const headerId = `header:${node.id}`;
  const sortable = useSortable({ id: headerId, disabled: dndDisabled || node.kind === "ungrouped" });
  const drop = useDroppable({ id: node.kind === "ungrouped" ? "container:ungrouped" : headerId, disabled: dndDisabled });
  const emptyGroupDrop = useDroppable({ id: `container:group:${node.id}`, disabled: dndDisabled || node.kind !== "group" || node.sessionIds.length > 0 });
  const collapsed = node.kind !== "ungrouped" && node.collapsed;
  const containerLabel = node.kind === "ungrouped" ? "container:ungrouped" : headerId;
  const collapseLabel = collapsed
    ? `展开${node.kind === "project" ? "项目" : "分组"} ${node.name}`
    : `折叠${node.kind === "project" ? "项目" : "分组"} ${node.name}`;
  return <section ref={drop.setNodeRef} className="mb-1">
    <div ref={sortable.setNodeRef} style={{ transform: CSS.Transform.toString(sortable.transform), transition: sortable.transition }} className="group flex items-center gap-1 rounded-md px-1.5 py-1 ">
      {node.kind !== "ungrouped" && <button type="button" {...sortable.attributes} {...sortable.listeners} aria-label="拖动" className="cursor-grab text-(--color-app-faint) opacity-0 group-hover:opacity-100 focus:opacity-100"><GripVertical size={12} /></button>}
      {node.kind !== "ungrouped" && <button type="button" onClick={() => onCollapse(!collapsed)} aria-label={collapseLabel} className="text-(--color-app-muted)"><ChevronRight size={13} className={collapsed ? "" : "rotate-90"} /></button>}
      <span className="truncate font-medium text-(--color-app-text)" data-container-id={containerLabel}>{node.name}</span><span className="ml-auto text-(--color-app-faint)">{node.sessionIds.length}</span>
    </div>
    {!collapsed && <ul className="ml-3 space-y-px border-l border-(--color-app-border) pl-2"><SortableContext items={node.sessionIds.map((id) => `session:${id}`)} strategy={verticalListSortingStrategy}>{node.sessionIds.map((id) => { const session = sessions.get(id); return session ? <SessionRow key={id} session={session} active={id === activeId} status={statuses.get(id)} archived={archived[id] === true} onSelect={onSelect} onDelete={onDelete} onArchive={onArchive} dndDisabled={dndDisabled} deleteLabel={deleteLabel} /> : null; })}</SortableContext>{node.kind === "group" && node.sessionIds.length === 0 && <li ref={emptyGroupDrop.setNodeRef} className="rounded-md border border-dashed border-(--color-app-border) px-2 py-2 text-(--color-app-muted)"><button type="button" aria-label={`在 ${node.name} 中新建任务`} onClick={() => { if (onNewInGroup) onNewInGroup(node.id); else onNew(); }} className="text-left hover:text-(--color-app-text)">新建任务</button><div role="button" aria-label={`拖放到 ${node.name}`} tabIndex={0} className="mt-1">或拖放到这里…</div></li>}</ul>}
  </section>;
}

function SessionRow({ session, active, status, archived, onSelect, onDelete, onArchive, dndDisabled, deleteLabel }: { session: Session; active: boolean; status?: SidebarSessionStatus; archived: boolean; onSelect: (id: string) => void; onDelete: (id: string) => void; onArchive: (id: string) => void; dndDisabled: boolean; deleteLabel: string }): React.JSX.Element {
  const sortable = useSortable({ id: `session:${session.id}`, disabled: dndDisabled || archived });
  return <li ref={sortable.setNodeRef} style={{ transform: CSS.Transform.toString(sortable.transform), transition: sortable.transition }} className="group relative flex items-center">
    {!archived && <button type="button" {...sortable.attributes} {...sortable.listeners} aria-label="拖动" className="mr-0.5 shrink-0 cursor-grab text-(--color-app-faint) opacity-0 group-hover:opacity-100 focus:opacity-100"><GripVertical size={12} /></button>}
    <button type="button" onClick={() => onSelect(session.id)} title={session.title} className={`flex h-[30px] min-w-0 flex-1 items-center gap-1.5 rounded-md px-2 text-left ${active ? "bg-(--color-app-hover) font-medium text-(--color-app-strong)" : "text-(--color-app-text) hover:bg-(--color-app-hover)"}`}>
      {status === "running" ? <Asterisk aria-label="running" size={13} className="burst-spin shrink-0 text-(--color-app-accent)" /> : status === "waiting-permission" ? <ShieldAlert aria-label="waiting-permission" size={13} className="shrink-0 text-(--color-tool-warn)" /> : status === "failed" ? <CircleAlert aria-label="failed" size={13} className="shrink-0 text-(--color-tool-err)" /> : <span className="grid size-[13px] shrink-0 place-items-center rounded-full border border-(--color-app-border)" aria-hidden />}
      <span className="min-w-0 flex-1 truncate">{session.title}</span>
      <time className="shrink-0 font-normal text-(--color-app-faint)" dateTime={new Date(session.updatedAt).toISOString()}>{relativeTime(session.updatedAt)}</time>
    </button>
    {!archived && <button type="button" aria-label="归档会话" onClick={(event) => { event.stopPropagation(); onArchive(session.id); }} className="absolute right-7 top-1/2 hidden -translate-y-1/2 rounded px-1 text-(--color-app-muted) hover:text-(--color-app-text) group-hover:block"><Archive size={12} /></button>}
    <button type="button" aria-label={deleteLabel} onClick={(event) => { event.stopPropagation(); onDelete(session.id); }} className="absolute right-1.5 top-1/2 hidden -translate-y-1/2 rounded px-1 text-(--color-app-muted) hover:text-(--color-app-text) group-hover:block"><X size={12} /></button>
  </li>;
}

function relativeTime(timestamp: number): string {
  const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60_000));
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes}分`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours}时` : `${Math.floor(hours / 24)}天`;
}

function ArchivedSection({ expanded, sessions, activeId, onSelect, onRestore, onDelete, onToggle, deleteLabel }: { expanded: boolean; sessions: readonly Session[]; activeId: string | null; onSelect: (id: string) => void; onRestore: (id: string) => void; onDelete: (id: string) => void; onToggle: () => void; deleteLabel: string }): React.JSX.Element | null {
  if (sessions.length === 0) return null;
  return <section className="mt-3 border-t border-(--color-app-hairline) pt-2">
    <button type="button" onClick={onToggle} aria-expanded={expanded} className="flex w-full items-center gap-1 rounded-md px-2 py-1.5 text-left text-(--color-app-muted) hover:bg-(--color-app-hover) hover:text-(--color-app-text)"><ChevronRight size={13} className={expanded ? "rotate-90" : ""} />Archived<span className="ml-auto ">{sessions.length}</span></button>
    {expanded && <ul className="ml-3 space-y-px border-l border-(--color-app-border) pl-2">{sessions.map((session) => <li key={session.id} className="group relative flex items-center"><button type="button" onClick={() => onSelect(session.id)} className={`min-w-0 flex-1 truncate rounded-md px-2 py-1.5 text-left ${activeId === session.id ? "bg-(--color-app-hover) font-medium text-(--color-app-strong)" : "text-(--color-app-text) hover:bg-(--color-app-hover)"}`}>{session.title}</button><button type="button" aria-label="恢复归档" onClick={() => onRestore(session.id)} className="absolute right-7 top-1/2 hidden -translate-y-1/2 group-hover:block"><ArchiveRestore size={12} /></button><button type="button" aria-label={deleteLabel} onClick={() => onDelete(session.id)} className="absolute right-1.5 top-1/2 hidden -translate-y-1/2 group-hover:block">✕</button></li>)}</ul>}
  </section>;
}
