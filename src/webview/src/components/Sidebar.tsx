// Sidebar navigation: durable trees, explicit id-only drag commands, and archive recovery.
import { useMemo, useRef, useState } from "react";
import { DndContext, closestCenter, useDroppable, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  Archive,
  ArchiveRestore,
  Bell,
  ChevronRight,
  CircleAlert,
  GripVertical,
  LoaderCircle,
  MessageSquare,
  MessageSquarePlus,
  Search,
  Settings,
  ShieldAlert,
  Store,
  Workflow,
  Hash,
  FolderTree,
  X,
} from "lucide-react";
import logoUrl from "../../../../logo.svg";
import type { Session } from "../../../shared/ipc";
import type { SidebarStateController } from "../state/useSidebarState";
import { resolveSidebarDrag } from "./sidebar/dnd";
import { buildSidebarTree, type SidebarTreeNode, type SidebarView } from "./sidebar/viewModel";

export type SidebarSessionStatus = "running" | "waiting-permission" | "failed";

interface Props {
  t: (key: string) => string;
  appName: string;
  sessions: Session[];
  activeId: string | null;
  sessionStatuses?: ReadonlyMap<string, SidebarSessionStatus>;
  sidebar: SidebarStateController;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  onArchive: (id: string) => void;
  onOpenSettings: () => void;
  onSearch?: () => void;
  onAutomation?: () => void;
  onPlugins?: () => void;
}

const NAV_ITEMS = [
  { icon: MessageSquarePlus, key: "sidebar.nav.newChat", action: "new" },
  { icon: Search, key: "sidebar.nav.search", action: "search" },
  { icon: Workflow, key: "sidebar.nav.automation", action: "automation" },
  { icon: Store, key: "sidebar.nav.plugins", action: "plugins" },
] as const;

export function Sidebar({ t, appName, sessions, activeId, sessionStatuses = new Map(), sidebar, onSelect, onNew, onDelete, onArchive, onOpenSettings, onSearch, onAutomation, onPlugins }: Props): React.JSX.Element {
  const [query, setQuery] = useState("");
  const [view, setView] = useState<SidebarView>("projects");
  const [archivedExpanded, setArchivedExpanded] = useState(false);
  const filterRef = useRef<HTMLInputElement>(null);
  const filterActive = query.trim().length > 0;
  const filtered = useMemo(() => filterActive ? sessions.filter((session) => session.title.toLowerCase().includes(query.trim().toLowerCase())) : sessions, [sessions, query, filterActive]);
  const tree = useMemo(() => buildSidebarTree(filtered, sidebar.state, view, t("sidebar.noProject")), [filtered, sidebar.state, t, view]);
  const byId = useMemo(() => new Map(sessions.map((session) => [session.id, session])), [sessions]);
  const archivedSessions = useMemo(() => sidebar.state.order.map((id) => byId.get(id)).filter((session): session is Session => session !== undefined && sidebar.state.archived[session.id] === true), [sidebar.state, byId]);
  const headerIds = useMemo(() => tree.filter((node) => node.kind !== "ungrouped").map((node) => `header:${node.id}`), [tree]);

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

  return (
    <aside className="flex h-full w-full flex-col overflow-hidden">
      <div className="flex items-center gap-2 px-3 pb-2 pt-3">
        <img src={logoUrl} alt={`${appName} Logo`} className="size-6 rounded-md" />
        <span className="truncate text-[15px] font-semibold">{appName}</span>
        <div className="flex-1" />
        <button type="button" aria-label={t("sidebar.noNotifications")} className="grid size-7 place-items-center rounded-full text-(--color-app-muted) hover:bg-(--color-app-bubble)"><Bell size={15} /></button>
      </div>
      <nav className="flex flex-col gap-0.5 px-2 pb-3">
        {NAV_ITEMS.map(({ icon: Icon, key, action }) => <button key={key} type="button" onClick={actionFor(action)} title={t(key)} className="flex items-center gap-2.5 rounded-xl px-2 py-1.5 text-left text-sm hover:bg-(--color-app-bubble)"><Icon size={16} className="text-(--color-app-muted)" />{t(key)}</button>)}
      </nav>
      <div className="scrollbar-thin flex-1 overflow-y-auto px-2">
        <div className="mb-2 flex gap-1 rounded-full bg-(--color-app-bubble) p-0.5 text-xs">
          <button type="button" onClick={() => setView("groups")} className={`flex flex-1 items-center justify-center gap-1 rounded-full px-2 py-1 ${view === "groups" ? "bg-(--color-app-panel) font-medium" : "text-(--color-app-muted)"}`}><Hash size={12} />{t("sidebar.groups")}</button>
          <button type="button" onClick={() => setView("projects")} className={`flex flex-1 items-center justify-center gap-1 rounded-full px-2 py-1 ${view === "projects" ? "bg-(--color-app-panel) font-medium" : "text-(--color-app-muted)"}`}><FolderTree size={12} />{t("sidebar.projects")}</button>
        </div>
        <input ref={filterRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("sidebar.filter")} className="mb-2 w-full rounded-full border border-transparent bg-(--color-app-bubble) px-3.5 py-1.5 text-xs outline-none focus:border-(--color-app-accent)" />
        <DndContext collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={headerIds} strategy={verticalListSortingStrategy}>
            {tree.map((node) => <TreeNode key={node.id} node={node} sessions={byId} archived={sidebar.state.archived} activeId={activeId} statuses={sessionStatuses} onSelect={onSelect} onDelete={onDelete} onArchive={onArchive} onCollapse={(collapsed) => void sidebar.setSidebarGroupCollapsed(node.id, collapsed)} dndDisabled={filterActive} deleteLabel={t("sidebar.delete")} />)}
          </SortableContext>
        </DndContext>
        {tree.length === 0 && <div className="px-2 py-3 text-center text-xs text-(--color-app-muted)">{t("sidebar.empty")}</div>}
        <ArchivedSection expanded={archivedExpanded} sessions={archivedSessions} activeId={activeId} onSelect={onSelect} onRestore={(id) => onArchive(id)} onDelete={onDelete} onToggle={() => setArchivedExpanded((value) => !value)} deleteLabel={t("sidebar.delete")} />
      </div>
      <footer className="flex items-center justify-between border-t border-(--color-app-hairline) px-3 py-2.5">
        <span className="rounded-full bg-(--color-app-bubble) px-2.5 py-1 text-[11px] font-semibold tracking-wide">{t("sidebar.localMode")}</span>
        <button type="button" onClick={onOpenSettings} aria-label={t("sidebar.settings")} className="grid size-7 place-items-center rounded-full text-(--color-app-muted) hover:bg-(--color-app-bubble)"><Settings size={15} /></button>
      </footer>
    </aside>
  );
}

function TreeNode({ node, sessions, archived, activeId, statuses, onSelect, onDelete, onArchive, onCollapse, dndDisabled, deleteLabel }: { node: SidebarTreeNode; sessions: ReadonlyMap<string, Session>; archived: Readonly<Record<string, boolean>>; activeId: string | null; statuses: ReadonlyMap<string, SidebarSessionStatus>; onSelect: (id: string) => void; onDelete: (id: string) => void; onArchive: (id: string) => void; onCollapse: (collapsed: boolean) => void; dndDisabled: boolean; deleteLabel: string }): React.JSX.Element {
  const headerId = `header:${node.id}`;
  const sortable = useSortable({ id: headerId, disabled: dndDisabled || node.kind === "ungrouped" });
  const drop = useDroppable({ id: node.kind === "ungrouped" ? "container:ungrouped" : headerId, disabled: dndDisabled });
  const collapsed = node.kind === "group" && node.collapsed;
  const containerLabel = node.kind === "ungrouped" ? "container:ungrouped" : headerId;
  return <section ref={drop.setNodeRef} className="mb-1">
    <div ref={sortable.setNodeRef} style={{ transform: CSS.Transform.toString(sortable.transform), transition: sortable.transition }} className="group flex items-center gap-1 rounded-xl px-1 py-1.5 text-sm">
      {node.kind !== "ungrouped" && <button type="button" {...sortable.attributes} {...sortable.listeners} aria-label="拖动" className="cursor-grab text-(--color-app-muted) opacity-0 group-hover:opacity-100 focus:opacity-100"><GripVertical size={13} /></button>}
      {node.kind === "group" ? <button type="button" onClick={() => onCollapse(!collapsed)} aria-label={collapsed ? "展开分组" : "折叠分组"}><ChevronRight size={14} className={collapsed ? "" : "rotate-90"} /></button> : <span className="size-3" />}
      <span className="truncate font-medium" data-container-id={containerLabel}>{node.name}</span><span className="ml-auto text-[10px] text-(--color-app-muted)">{node.sessionIds.length}</span>
    </div>
    {!collapsed && <ul className="ml-[13px] space-y-0.5 border-l border-(--color-app-border) pl-2"><SortableContext items={node.sessionIds.map((id) => `session:${id}`)} strategy={verticalListSortingStrategy}>{node.sessionIds.map((id) => { const session = sessions.get(id); return session ? <SessionRow key={id} session={session} active={id === activeId} status={statuses.get(id)} archived={archived[id] === true} onSelect={onSelect} onDelete={onDelete} onArchive={onArchive} dndDisabled={dndDisabled} deleteLabel={deleteLabel} /> : null; })}</SortableContext></ul>}
  </section>;
}

function SessionRow({ session, active, status, archived, onSelect, onDelete, onArchive, dndDisabled, deleteLabel }: { session: Session; active: boolean; status?: SidebarSessionStatus; archived: boolean; onSelect: (id: string) => void; onDelete: (id: string) => void; onArchive: (id: string) => void; dndDisabled: boolean; deleteLabel: string }): React.JSX.Element {
  const sortable = useSortable({ id: `session:${session.id}`, disabled: dndDisabled || archived });
  return <li ref={sortable.setNodeRef} style={{ transform: CSS.Transform.toString(sortable.transform), transition: sortable.transition }} className="group relative flex items-center">
    {!archived && <button type="button" {...sortable.attributes} {...sortable.listeners} aria-label="拖动" className="mr-0.5 shrink-0 cursor-grab text-(--color-app-muted) opacity-0 group-hover:opacity-100 focus:opacity-100"><GripVertical size={12} /></button>}
    <button type="button" onClick={() => onSelect(session.id)} title={session.title} className={`flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-sm ${active ? "bg-(--color-app-accent-soft) font-medium text-(--color-app-accent)" : "hover:bg-(--color-app-bubble)"}`}>
      {status === "running" ? <LoaderCircle aria-label="running" size={13} className="shrink-0 animate-spin" /> : status === "waiting-permission" ? <ShieldAlert aria-label="waiting-permission" size={13} className="shrink-0" /> : status === "failed" ? <CircleAlert aria-label="failed" size={13} className="shrink-0 text-(--color-tool-err)" /> : <MessageSquare size={12} className="shrink-0 text-(--color-app-muted)" />}
      <span className="min-w-0 flex-1 truncate">{session.title}</span>
      <time className="shrink-0 text-[10px] font-normal text-(--color-app-muted)" dateTime={new Date(session.updatedAt).toISOString()}>{relativeTime(session.updatedAt)}</time>
    </button>
    {!archived && <button type="button" aria-label="归档会话" onClick={(event) => { event.stopPropagation(); onArchive(session.id); }} className="absolute right-7 top-1/2 hidden -translate-y-1/2 rounded px-1 text-xs text-(--color-app-muted) hover:text-(--color-app-text) group-hover:block"><Archive size={12} /></button>}
    <button type="button" aria-label={deleteLabel} onClick={(event) => { event.stopPropagation(); onDelete(session.id); }} className="absolute right-1.5 top-1/2 hidden -translate-y-1/2 rounded px-1 text-xs text-(--color-app-muted) hover:text-(--color-app-text) group-hover:block"><X size={12} /></button>
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
    <button type="button" onClick={onToggle} aria-expanded={expanded} className="flex w-full items-center gap-1 rounded-xl px-2 py-1.5 text-left text-sm text-(--color-app-muted) hover:bg-(--color-app-bubble)"><ChevronRight size={14} className={expanded ? "rotate-90" : ""} />Archived<span className="ml-auto text-[10px]">{sessions.length}</span></button>
    {expanded && <ul className="ml-[13px] space-y-0.5 border-l border-(--color-app-border) pl-2">{sessions.map((session) => <li key={session.id} className="group relative flex items-center"><button type="button" onClick={() => onSelect(session.id)} className={`min-w-0 flex-1 truncate rounded-xl px-2 py-1.5 text-left text-sm ${activeId === session.id ? "bg-(--color-app-accent-soft) font-medium text-(--color-app-accent)" : "hover:bg-(--color-app-bubble)"}`}>{session.title}</button><button type="button" aria-label="恢复归档" onClick={() => onRestore(session.id)} className="absolute right-7 top-1/2 hidden -translate-y-1/2 group-hover:block"><ArchiveRestore size={12} /></button><button type="button" aria-label={deleteLabel} onClick={() => onDelete(session.id)} className="absolute right-1.5 top-1/2 hidden -translate-y-1/2 group-hover:block">✕</button></li>)}</ul>}
  </section>;
}
