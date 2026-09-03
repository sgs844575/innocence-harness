// 项目树视图：在按项目聚合的树上再包一层「项目 / 任务」顶层分组。
// 分组行：左侧开合 chevron + 图标 + 名称；悬停出拖拽手柄（上下拖动调整
// 分组顺序：拖动中该组半透明，目标行上/下缘出 accent 指示线，落下重放落位动画；
// 顺序为本地状态不持久化）与「+」钮（项目组 = 新建项目，任务组 = 新建会话）。
// 项目组内各项目分节保留原有悬停动作：… 菜单 / 文件树 / 新建任务。
import { useState } from "react";
import {
  ChevronRight,
  Folder,
  FolderTree,
  GripVertical,
  ListTodo,
  MoreHorizontal,
  Plus,
} from "lucide-react";
import type { ProjectNode } from "../state/sidebarTree";
import { DropdownMenu, DropdownMenuItem } from "./ui/DropdownMenu";
import { SessionRow } from "./SessionRow";

/** 顶层分组 id（折叠状态与「收起全部」按 id 追踪，须与 Sidebar 共享）。 */
export const GROUP_ID_PROJECTS = "__grp_projects__";
export const GROUP_ID_TASKS = "__grp_tasks__";
type GroupId = typeof GROUP_ID_PROJECTS | typeof GROUP_ID_TASKS;

interface Props {
  t: (key: string) => string;
  tree: readonly ProjectNode[];
  activeId: string | null;
  runningIds?: ReadonlySet<string>;
  collapsed: ReadonlySet<string>;
  onToggleCollapsed: (id: string) => void;
  onSelect: (id: string) => void;
  onArchive: (id: string) => void;
  /** 任务组「+」：新建无项目会话。 */
  onNewSession: () => void;
  /** 项目组「+」：选目录新建项目（无桥接能力时缺省 = 不渲染该钮）。 */
  onNewProject?: () => void;
  /** 项目行「新建任务」：在该项目根下开新会话（缺省 = 不渲染该钮）。 */
  onNewTaskInProject?: (root: string) => void;
  /** 项目行「浏览文件」进入文件树（缺省 = 不渲染该钮）。 */
  onOpenProjectFiles?: (root: string) => void;
  /** 项目行「…」菜单：在资源管理器中打开项目根。 */
  onRevealProject?: (root: string) => void;
}

export function SidebarProjectTree({
  t,
  tree,
  activeId,
  runningIds,
  collapsed,
  onToggleCollapsed,
  onSelect,
  onArchive,
  onNewSession,
  onNewProject,
  onNewTaskInProject,
  onOpenProjectFiles,
  onRevealProject,
}: Props): React.JSX.Element {
  const projectNodes = tree.filter((node) => node.id !== "");
  const taskNode = tree.find((node) => node.id === "");
  const [order, setOrder] = useState<readonly GroupId[]>([GROUP_ID_PROJECTS, GROUP_ID_TASKS]);
  /** 拖拽状态：dragging = 拖动中的分组（行变半透明）；dropTarget = 落点行 + 插入前/后（指示线）。 */
  const [dragging, setDragging] = useState<GroupId | null>(null);
  const [dropTarget, setDropTarget] = useState<{ id: GroupId; where: "before" | "after" } | null>(null);
  /** 落定位移动画：n 递增改 key 重挂载被移动的分组，重放 .drop-settle。 */
  const [settled, setSettled] = useState<{ id: GroupId; n: number } | null>(null);

  const groups: { id: GroupId; name: string }[] = [];
  if (projectNodes.length > 0) {
    groups.push({ id: GROUP_ID_PROJECTS, name: t("sidebar.group.projects") });
  }
  if (taskNode) {
    groups.push({ id: GROUP_ID_TASKS, name: t("sidebar.noProject") });
  }
  const ordered = order
    .map((id) => groups.find((group) => group.id === id))
    .filter((group): group is (typeof groups)[number] => group !== undefined);

  const endDrag = () => {
    setDragging(null);
    setDropTarget(null);
  };
  const dropOn = (target: GroupId, where: "before" | "after") => {
    const from = dragging;
    endDrag();
    if (from === null || from === target) return;
    setOrder((current) => {
      const next = current.filter((id) => id !== from);
      const at = next.indexOf(target);
      next.splice(where === "after" ? at + 1 : at, 0, from);
      return next;
    });
    setSettled((current) => ({ id: from, n: (current?.id === from ? current.n : 0) + 1 }));
  };

  const renderProjectSection = (node: ProjectNode) => {
    const isCollapsed = collapsed.has(node.id);
    return (
      <section key={node.id} className="mb-1">
        <div className="group flex items-center gap-1 rounded-md px-1.5 py-1">
          <button
            type="button"
            onClick={() => onToggleCollapsed(node.id)}
            aria-expanded={!isCollapsed}
            aria-label={`${isCollapsed ? t("sidebar.expand") : t("sidebar.collapse")} ${node.name}`}
            title={`${isCollapsed ? t("sidebar.expand") : t("sidebar.collapse")} ${node.name}`}
            className="text-(--color-muted)"
          >
            <ChevronRight size={13} className={isCollapsed ? "" : "rotate-90"} />
          </button>
          <Folder size={13} className="shrink-0 text-(--color-faint)" aria-hidden />
          <span className="truncate font-medium text-(--color-foreground)">{node.name}</span>
          {/* 项目行悬停动作：… 菜单 / 文件树 / 新建任务。 */}
          {(onRevealProject || onOpenProjectFiles || onNewTaskInProject) && (
            <span className="ml-auto flex items-center opacity-0 transition-opacity group-hover:opacity-100 motion-reduce:transition-none">
              {onRevealProject && (
                <DropdownMenu
                  align="end"
                  sideOffset={4}
                  trigger={
                    <button
                      type="button"
                      aria-label={t("sidebar.project.menu")}
                      title={t("sidebar.project.menu")}
                      className="rounded p-0.5 text-(--color-muted) hover:text-(--color-foreground)"
                    >
                      <MoreHorizontal size={13} />
                    </button>
                  }
                >
                  <DropdownMenuItem onSelect={() => onRevealProject(node.id)}>
                    {t("titlebar.menu.openExplorer")}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={() => void navigator.clipboard?.writeText(node.id).catch(() => undefined)}
                  >
                    {t("titlebar.menu.copyPath")}
                  </DropdownMenuItem>
                </DropdownMenu>
              )}
              {onOpenProjectFiles && (
                <button
                  type="button"
                  aria-label={t("sidebar.project.files")}
                  title={t("sidebar.project.files")}
                  onClick={() => onOpenProjectFiles(node.id)}
                  className="rounded p-0.5 text-(--color-muted) hover:text-(--color-foreground)"
                >
                  <FolderTree size={13} />
                </button>
              )}
              {onNewTaskInProject && (
                <button
                  type="button"
                  aria-label={t("sidebar.project.newTask")}
                  title={t("sidebar.project.newTask")}
                  onClick={() => onNewTaskInProject(node.id)}
                  className="rounded p-0.5 text-(--color-muted) hover:text-(--color-foreground)"
                >
                  <Plus size={13} />
                </button>
              )}
            </span>
          )}
        </div>
        {!isCollapsed && (
          <ul className="ml-3 space-y-px border-l border-(--color-border) pl-2">
            {node.sessions.map((session) => (
              <SessionRow
                key={session.id}
                session={session}
                active={session.id === activeId}
                running={runningIds?.has(session.id) === true}
                onSelect={onSelect}
                onArchive={onArchive}
                archiveLabel={t("sidebar.archive")}
              />
            ))}
          </ul>
        )}
      </section>
    );
  };

  return (
    <>
      {ordered.map((group) => {
        const isCollapsed = collapsed.has(group.id);
        const GroupIcon = group.id === GROUP_ID_PROJECTS ? Folder : ListTodo;
        return (
          <section
            key={group.id === settled?.id ? `${group.id}#${settled.n}` : group.id}
            className={`mb-1 ${group.id === settled?.id ? "drop-settle" : ""}`}
          >
            <div
              className={`group relative flex items-center gap-1 rounded-md px-1.5 py-1 ${
                dragging === group.id ? "opacity-40" : ""
              }`}
              onDragOver={(event) => {
                if (dragging === null || dragging === group.id) return;
                event.preventDefault();
                // 鼠标在行的下半部分 = 插入其后；否则插入其前（含合成事件无 clientY 的情况）。
                const rect = event.currentTarget.getBoundingClientRect();
                const where = event.clientY > rect.top + rect.height / 2 ? "after" : "before";
                setDropTarget((current) =>
                  current !== null && current.id === group.id && current.where === where
                    ? current
                    : { id: group.id, where },
                );
              }}
              onDragLeave={() => setDropTarget((current) => (current?.id === group.id ? null : current))}
              onDrop={(event) => {
                event.preventDefault();
                dropOn(group.id, dropTarget?.id === group.id ? dropTarget.where : "before");
              }}
            >
              {dropTarget?.id === group.id && (
                <span
                  aria-hidden
                  className={`drop-indicator ${dropTarget.where === "before" ? "top-[-1px]" : "bottom-[-1px]"}`}
                />
              )}
              <button
                type="button"
                onClick={() => onToggleCollapsed(group.id)}
                aria-expanded={!isCollapsed}
                aria-label={`${isCollapsed ? t("sidebar.expand") : t("sidebar.collapse")} ${group.name}`}
                title={`${isCollapsed ? t("sidebar.expand") : t("sidebar.collapse")} ${group.name}`}
                className="text-(--color-muted)"
              >
                <ChevronRight size={13} className={isCollapsed ? "" : "rotate-90"} />
              </button>
              <GroupIcon size={13} className="shrink-0 text-(--color-faint)" aria-hidden />
              <span className="truncate font-medium text-(--color-foreground)">{group.name}</span>
              {/* 分组悬停动作：拖拽手柄（上下调序）+ 新建（项目/会话）。 */}
              <span className="ml-auto flex items-center opacity-0 transition-opacity group-hover:opacity-100 motion-reduce:transition-none">
                <button
                  type="button"
                  draggable
                  aria-label={t("sidebar.group.reorder")}
                  title={t("sidebar.group.reorder")}
                  onDragStart={(event) => {
                    setDragging(group.id);
                    // jsdom 无 dataTransfer；原生拖拽仅需 effectAllowed 提示。
                    if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
                  }}
                  onDragEnd={endDrag}
                  className="cursor-grab rounded p-0.5 text-(--color-muted) hover:text-(--color-foreground) active:cursor-grabbing"
                >
                  <GripVertical size={13} />
                </button>
                {(group.id === GROUP_ID_TASKS || onNewProject) && (
                  <button
                    type="button"
                    aria-label={group.id === GROUP_ID_PROJECTS ? t("sidebar.group.newProject") : t("sidebar.group.newSession")}
                    title={group.id === GROUP_ID_PROJECTS ? t("sidebar.group.newProject") : t("sidebar.group.newSession")}
                    onClick={() => (group.id === GROUP_ID_PROJECTS ? onNewProject?.() : onNewSession())}
                    className="rounded p-0.5 text-(--color-muted) hover:text-(--color-foreground)"
                  >
                    <Plus size={13} />
                  </button>
                )}
              </span>
            </div>
            {!isCollapsed &&
              (group.id === GROUP_ID_PROJECTS ? (
                <div className="ml-3 border-l border-(--color-border) pl-2">
                  {projectNodes.map(renderProjectSection)}
                </div>
              ) : (
                <ul className="ml-3 space-y-px border-l border-(--color-border) pl-2">
                  {taskNode?.sessions.map((session) => (
                    <SessionRow
                      key={session.id}
                      session={session}
                      active={session.id === activeId}
                      running={runningIds?.has(session.id) === true}
                      onSelect={onSelect}
                      onArchive={onArchive}
                      archiveLabel={t("sidebar.archive")}
                    />
                  ))}
                </ul>
              ))}
          </section>
        );
      })}
    </>
  );
}
