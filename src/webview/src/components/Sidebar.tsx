// 侧栏：菜单块（新建/搜索/自动化/插件市场）+ 分组/项目芯片 + 收起全部 +
// 筛选弹出面板（视图：按项目/时间线；排序：更新时间/创建时间）+ 项目会话树 +
// 底部用户行。项目视图按 workspaceRoot 聚合后再包「项目/任务」顶层分组
// （SidebarProjectTree：可折叠、悬停拖拽调序、「+」新建项目/新会话）；
// 分组视图为只读分组列表。
// 项目行悬停出三个动作：… 菜单（在资源管理器中打开/复制路径）/ 文件树 / 新建任务。
// 归档图标把内容区整切为归档列表（标题+时间+项目+恢复/删除），再点返回。
import { useEffect, useMemo, useState } from "react";
import {
  Archive,
  ArchiveRestore,
  Check,
  CirclePlus,
  Clock,
  Expand,
  Filter,
  Folder,
  Hash,
  LayoutGrid,
  ListTree,
  Search,
  Settings,
  Shrink,
  Trash2,
  Workflow,
} from "lucide-react";
import logoUrl from "../../../../logo.svg";
import type { Session } from "../../../shared/ipc";
import type { SidebarGroup } from "../../../shared/sidebarIpc";
import { buildProjectTree, pinnedFirst } from "../state/sidebarTree";
import { projectName } from "../state/useSessions";
import { loadUiState, patchUiState } from "../state/uiState";
import { relativeTime } from "../lib/time";
import { Popover } from "./ui/Popover";
import { FileExplorer } from "./FileExplorer";
import { SessionRow } from "./SessionRow";
import { GROUP_ID_PROJECTS, GROUP_ID_TASKS, SidebarProjectTree } from "./SidebarProjectTree";
import { CreateGroupPopover, GroupsView, type GroupActions } from "./sidebar/GroupsView";

export type SidebarView = "groups" | "projects";
/** 项目芯片内的布局：按项目 = 项目树；时间线 = 扁平时间序列表。 */
type SidebarLayout = "tree" | "timeline";
type SidebarSort = "updated" | "created";

interface Props {
  t: (key: string) => string;
  sessions: Session[];
  activeId: string | null;
  /** 流式中的会话 id 集合（运行态图标）。 */
  runningIds?: ReadonlySet<string>;
  archived: Readonly<Record<string, boolean>>;
  /** 置顶标记（缺省空表；置顶会话行首 Pin 图标 + 各容器内排前）。 */
  pinned?: Readonly<Record<string, boolean>>;
  unread?: Readonly<Record<string, boolean>>;
  /** 分组视图的持久分组（sidebar 状态；缺省为空列表）。 */
  groups?: readonly SidebarGroup[];
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  onArchive: (id: string) => void;
  /** 归档区恢复（取消归档）。 */
  onRestore: (id: string) => void;
  onOpenSettings: () => void;
  onSearch: () => void;
  onAutomation: () => void;
  onPlugins: () => void;
  /** 项目组「+」：选目录新建项目（缺省 = 不渲染该钮）。 */
  onNewProject?: () => void;
  /** 项目行「新建任务」：在该项目根下开新会话（缺省 = 不渲染该钮）。 */
  onNewTaskInProject?: (root: string) => void;
  /** 项目行「浏览文件」进入文件树；树内点文件经此回传（root + 相对路径）。 */
  onOpenProjectFile?: (root: string, relPath: string) => void;
  /** 项目行「…」菜单：在资源管理器中打开项目根。 */
  onRevealProject?: (root: string) => void;
  /** 分组动作（创建/移动/置顶/组内新建）；缺省 = 分组视图只读、无「#」新建钮。 */
  groupActions?: GroupActions;
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

export function Sidebar({
  t,
  sessions,
  activeId,
  runningIds,
  archived,
  pinned = {},
  unread = {},
  groups = [],
  onSelect,
  onNew,
  onDelete,
  onArchive,
  onRestore,
  onOpenSettings,
  onSearch,
  onAutomation,
  onPlugins,
  onNewProject,
  onNewTaskInProject,
  onOpenProjectFile,
  onRevealProject,
  groupActions,
}: Props): React.JSX.Element {
  // 视图/布局/排序/归档开关随 uiState 持久化——重启后保持上次关闭时的选择。
  const [view, setView] = useState<SidebarView>(() => loadUiState().sidebarView);
  const [layout, setLayout] = useState<SidebarLayout>(() => loadUiState().sidebarLayout);
  const [sort, setSort] = useState<SidebarSort>(() => loadUiState().sidebarSort);
  const [archivedOpen, setArchivedOpen] = useState(() => loadUiState().sidebarArchivedOpen);
  useEffect(() => {
    patchUiState({
      sidebarView: view,
      sidebarLayout: layout,
      sidebarSort: sort,
      sidebarArchivedOpen: archivedOpen,
    });
  }, [view, layout, sort, archivedOpen]);
  const sorted = useMemo(
    () =>
      [...sessions].sort((a, b) =>
        sort === "updated" ? b.updatedAt - a.updatedAt : b.createdAt - a.createdAt,
      ),
    [sessions, sort],
  );
  // 置顶会话稳定排前（扁平列表与未分组区共用该顺序；项目树内逐节点排前）。
  const ordered = useMemo(() => pinnedFirst(sorted, pinned), [sorted, pinned]);
  const tree = useMemo(
    () => buildProjectTree(sorted, archived, t("sidebar.noProject"), pinned),
    [sorted, archived, t, pinned],
  );
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  /** 文件树模式：项目根（非 null 时内容区整切为 FileExplorer）。 */
  const [filesRoot, setFilesRoot] = useState<string | null>(null);

  const toggleCollapsed = (id: string) =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  /** 收起全部 ⇄ 展开全部：当前视图的全部分节 id；全收起后再点即全展开。
      项目树视图含「项目/任务」顶层分组 id + 各项目分节 id。 */
  const allSectionIds = useMemo(() => {
    if (view !== "projects") return [...groups.map((group) => group.id), "__ungrouped__"];
    const projectNodes = tree.filter((node) => node.id !== "");
    const ids: string[] = [];
    if (projectNodes.length > 0) ids.push(GROUP_ID_PROJECTS);
    if (tree.some((node) => node.id === "")) ids.push(GROUP_ID_TASKS);
    ids.push(...projectNodes.map((node) => node.id));
    return ids;
  }, [view, tree, groups]);
  const allCollapsed = allSectionIds.length > 0 && allSectionIds.every((id) => collapsed.has(id));
  const toggleCollapseAll = () =>
    setCollapsed((current) => {
      const every = allSectionIds.length > 0 && allSectionIds.every((id) => current.has(id));
      return every ? new Set<string>() : new Set(allSectionIds);
    });

  const actionFor = (action: (typeof NAV_ITEMS)[number]["action"]): (() => void) => {
    if (action === "new") return onNew;
    if (action === "search") return onSearch;
    if (action === "automation") return onAutomation;
    return onPlugins;
  };

  return (
    <aside data-testid="full-sidebar" className="flex h-full w-full flex-col overflow-hidden">
      {/* 菜单块 */}
      <nav className="flex flex-col gap-px px-2.5 pt-3.5">
        {NAV_ITEMS.map(({ icon: Icon, key, action, kbd }) => (
          <button
            key={key}
            type="button"
            onClick={actionFor(action)}
            title={t(key)}
            className="flex h-9 items-center gap-2.5 rounded-md px-2.5 text-left text-(--color-foreground) hover:bg-(--color-hover)"
          >
            <Icon size={16} className="text-(--color-muted)" />
            {t(key)}
            {kbd && (
              <span aria-hidden className="ml-auto text-(--color-faint)">
                {kbd}
              </span>
            )}
          </button>
        ))}
      </nav>

      {/* 分类芯片（带图标，对齐参考） + 筛选/归档工具 */}
      <div className="flex items-center gap-1 px-3.5 pt-3">
        {(["groups", "projects"] as const).map((next) => {
          const ChipIcon = next === "groups" ? Hash : Folder;
          return (
            <button
              key={next}
              type="button"
              onClick={() => setView(next)}
              aria-pressed={view === next}
              className={`flex h-[26px] items-center gap-1.5 rounded-full px-2.5 ${
                view === next
                  ? "bg-(--color-raised) font-medium text-(--color-foreground)"
                  : "text-(--color-muted) hover:text-(--color-foreground)"
              }`}
            >
              <ChipIcon size={13} aria-hidden />
              {t(next === "groups" ? "sidebar.groups" : "sidebar.projects")}
            </button>
          );
        })}
        <div className="ml-auto flex items-center gap-3.5 text-(--color-muted)">
          {/* 新建分组（仅分组视图；弹窗：名称 + 七色）。 */}
          {view === "groups" && groupActions && (
            <CreateGroupPopover t={t} onCreate={groupActions.createGroup} />
          )}
          {/* 收起全部 + 筛选（仅项目视图；分组视图不渲染）。 */}
          {view === "projects" && (
            <>
              <button
                type="button"
                aria-label={allCollapsed ? t("sidebar.expandAll") : t("sidebar.collapseAll")}
                title={allCollapsed ? t("sidebar.expandAll") : t("sidebar.collapseAll")}
                onClick={toggleCollapseAll}
                className="hover:text-(--color-foreground)"
              >
            {allCollapsed ? <Expand size={14} /> : <Shrink size={14} />}
          </button>
          <Popover
            side="bottom"
            align="end"
            contentClassName="w-52 p-1.5"
            trigger={
              <button
                type="button"
                aria-label={t("sidebar.filter")}
                title={t("sidebar.filter")}
                className="hover:text-(--color-foreground)"
              >
                <Filter size={14} />
              </button>
            }
          >
            <div className="px-2.5 pt-1 pb-1 text-(--color-faint)">{t("sidebar.view")}</div>
            {([
              { id: "tree" as const, key: "sidebar.view.tree", icon: ListTree },
              { id: "timeline" as const, key: "sidebar.view.timeline", icon: Clock },
            ]).map(({ id, key, icon: Icon }) => (
              <button
                key={id}
                type="button"
                aria-pressed={layout === id}
                onClick={() => setLayout(id)}
                className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-(--color-foreground) hover:bg-(--color-hover)"
              >
                <Icon size={13} className="shrink-0 text-(--color-muted)" />
                {t(key)}
                {layout === id && <Check size={13} className="ml-auto shrink-0 text-(--color-accent)" />}
              </button>
            ))}
            <div className="mx-1 my-1 h-px bg-(--color-hairline)" />
            <div className="px-2.5 pt-1 pb-1 text-(--color-faint)">{t("sidebar.sort")}</div>
            {([
              { id: "updated" as const, key: "sidebar.sort.updated", icon: Clock },
              { id: "created" as const, key: "sidebar.sort.created", icon: CirclePlus },
            ]).map(({ id, key, icon: Icon }) => (
              <button
                key={id}
                type="button"
                aria-pressed={sort === id}
                onClick={() => setSort(id)}
                className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-(--color-foreground) hover:bg-(--color-hover)"
              >
                <Icon size={13} className="shrink-0 text-(--color-muted)" />
                {t(key)}
                {sort === id && <Check size={13} className="ml-auto shrink-0 text-(--color-accent)" />}
              </button>
            ))}
          </Popover>
            </>
          )}
          <button
            type="button"
            aria-label={t("sidebar.archived")}
            title={t("sidebar.archived")}
            aria-expanded={archivedOpen}
            onClick={() => setArchivedOpen((value) => !value)}
            className={archivedOpen ? "text-(--color-accent)" : "hover:text-(--color-foreground)"}
          >
            <Archive size={14} />
          </button>
        </div>
      </div>

      {filesRoot !== null ? (
        /* 文件树模式：组件自带布局/滚动，不套会话列表的滚动容器。 */
        <FileExplorer
          t={t}
          root={filesRoot}
          onBack={() => setFilesRoot(null)}
          onOpenFile={(rel) => onOpenProjectFile?.(filesRoot, rel)}
        />
      ) : (
      <div className="scrollbar-thin flex-1 overflow-y-auto px-2 pt-1">
        {archivedOpen ? (
          <ArchivedList
            t={t}
            sessions={sessions}
            archived={archived}
            onSelect={onSelect}
            onRestore={onRestore}
            onDelete={onDelete}
          />
        ) : (
        <>
        {view === "groups" && (
          <GroupsView
            t={t}
            groups={groups}
            sessions={ordered}
            archived={archived}
            pinned={pinned}
            unread={unread}
            activeId={activeId}
            runningIds={runningIds}
            collapsed={collapsed}
            onToggleCollapsed={toggleCollapsed}
            onSelect={onSelect}
            onArchive={onArchive}
            groupActions={groupActions}
          />
        )}
        {view === "projects" && layout === "timeline" && (
          <ul className="space-y-px">
            {ordered.filter((session) => archived[session.id] !== true).map((session) => (
              <SessionRow
                key={session.id}
                session={session}
                active={session.id === activeId}
                running={runningIds?.has(session.id) === true}
                pinned={pinned[session.id] === true}
                unread={unread[session.id] === true}
                onSelect={onSelect}
                onArchive={onArchive}
                archiveLabel={t("sidebar.archive")}
              />
            ))}
            {ordered.every((session) => archived[session.id] === true) && (
              <li className="px-2 py-3 text-center text-(--color-muted)">{t("sidebar.empty")}</li>
            )}
          </ul>
        )}
        {view === "projects" && layout === "tree" && tree.length === 0 && (
          <div className="px-2 py-3 text-center text-(--color-muted)">{t("sidebar.empty")}</div>
        )}
        {view === "projects" && layout === "tree" && tree.length > 0 && (
          <SidebarProjectTree
            t={t}
            tree={tree}
            activeId={activeId}
            runningIds={runningIds}
            pinned={pinned}
            unread={unread}
            collapsed={collapsed}
            onToggleCollapsed={toggleCollapsed}
            onSelect={onSelect}
            onArchive={onArchive}
            onNewSession={onNew}
            onNewProject={onNewProject}
            onNewTaskInProject={onNewTaskInProject}
            onOpenProjectFiles={onOpenProjectFile ? (root) => setFilesRoot(root) : undefined}
            onRevealProject={onRevealProject}
          />
        )}
        </>
        )}
      </div>
      )}

      {/* 底部用户行：头像 + 用户名 + 本地徽标 + 状态点 + 设置。 */}<footer className="mt-auto flex shrink-0 items-center gap-2.5 px-4 pb-4 pt-2">
        <div className="grid size-8 shrink-0 place-items-center overflow-hidden rounded-full bg-(--color-background)">
          <img src={logoUrl} alt="" className="size-[15px] rounded-[3px]" />
        </div>
        <span className="min-w-0 truncate font-bold text-(--color-foreground-strong)">{t("user.you")}</span>
        <span className="shrink-0 rounded-full bg-(--color-background) px-1.5 py-0.5 leading-none text-(--color-muted)">
          {t("sidebar.localMode")}
        </span>
        <div className="ml-auto flex items-center gap-1">
          <span aria-label={t("status.ok")} title={t("status.ok")} className="grid size-7 place-items-center">
            <span className="size-2 rounded-full bg-(--color-tool-ok)" />
          </span>
          <button
            type="button"
            onClick={onOpenSettings}
            aria-label={t("sidebar.settings")}
            className="grid size-7 place-items-center rounded-md text-(--color-muted) hover:bg-(--color-hover) hover:text-(--color-foreground)"
          >
            <Settings size={15} />
          </button>
        </div>
      </footer>
    </aside>
  );
}

/** 归档整列表（归档图标切换进入）：两行结构——标题 + 相对时间 /
 *  项目名 + 恢复/删除（常驻可见，对齐参考归档页）。 */
function ArchivedList({
  t,
  sessions,
  archived,
  onSelect,
  onRestore,
  onDelete,
}: {
  t: (key: string) => string;
  sessions: Session[];
  archived: Readonly<Record<string, boolean>>;
  onSelect: (id: string) => void;
  onRestore: (id: string) => void;
  onDelete: (id: string) => void;
}): React.JSX.Element {
  const list = sessions.filter((session) => archived[session.id] === true);
  if (list.length === 0) {
    return <div className="px-2 py-3 text-center text-(--color-muted)">{t("sidebar.empty")}</div>;
  }
  return (
    <ul className="space-y-1">
      {list.map((session) => {
        const root = session.workspaceRoot?.trim() ?? "";
        return (
          <li key={session.id} className="rounded-md px-1.5 py-1.5 hover:bg-(--color-hover)">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => onSelect(session.id)}
                title={session.title}
                className="min-w-0 flex-1 truncate text-left text-(--color-foreground)"
              >
                {session.title}
              </button>
              <time
                className="shrink-0 text-(--color-faint)"
                dateTime={new Date(session.updatedAt).toISOString()}
              >
                {relativeTime(session.updatedAt)}
              </time>
            </div>
            <div className="mt-1 flex items-center gap-1.5">
              <Folder size={12} className="shrink-0 text-(--color-faint)" aria-hidden />
              <span className="min-w-0 flex-1 truncate text-(--color-muted)">
                {root === "" ? t("sidebar.noProject") : projectName(root)}
              </span>
              <button
                type="button"
                aria-label={t("sidebar.restore")}
                title={t("sidebar.restore")}
                onClick={() => onRestore(session.id)}
                className="rounded p-0.5 text-(--color-muted) hover:text-(--color-foreground)"
              >
                <ArchiveRestore size={13} />
              </button>
              <button
                type="button"
                aria-label={t("sidebar.delete")}
                title={t("sidebar.delete")}
                onClick={() => onDelete(session.id)}
                className="rounded p-0.5 text-(--color-muted) hover:text-(--color-tool-err)"
              >
                <Trash2 size={13} />
              </button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
