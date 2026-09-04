// 分组视图（参考规格）：「#」新建分组弹窗（名称 + 七色）→ 分组节（彩色 # 图标 +
// 名称 + 悬停动作 ⊕新建会话/删除分组 + 开合）；组内行悬停动作条（移动到顶部/
// 移出分组/归档），行可拖拽到分组或未分组放置区；空分组给虚线提示（点击 = 组内
// 新建）；未分组平铺无节头。折叠状态本地维护（与项目视图一致）。
import { useMemo, useState } from "react";
import { Check, ChevronDown, ChevronRight, ChevronUp, Hash, Plus, Trash2 } from "lucide-react";
import type { Session } from "../../../../shared/ipc";
import type { SidebarGroup } from "../../../../shared/sidebarIpc";
import { pinnedFirst } from "../../state/sidebarTree";
import { Popover } from "../ui/Popover";
import { SessionRow } from "../SessionRow";

/** 分组动作（App 装配，经 Sidebar 透传）。 */
export interface GroupActions {
  createGroup: (name: string, color: string) => void;
  /** 移入分组；groupId = null 移出到未分组。 */
  moveSession: (id: string, groupId: string | null) => void;
  /** 组内置顶。 */
  moveToTop: (groupId: string, sessionId: string) => void;
  /** 组内新建会话（建空会话并归入该组）。 */
  newSessionInGroup: (groupId: string) => void;
  /** 删除分组（成员会话回落未分组，不删会话）。 */
  deleteGroup: (groupId: string) => void;
}

export const GROUP_COLORS = ["gray", "red", "orange", "yellow", "green", "blue", "purple"] as const;

/** 分组颜色 id → token 变量（未知 id 回落 gray）。 */
export function groupColorVar(color: string | undefined): string {
  const id = (GROUP_COLORS as readonly string[]).includes(color ?? "") ? color : "gray";
  return `var(--color-group-${id})`;
}

/** 「#」新建分组弹窗：名称输入（默认 New Group）+ 七色单选；Enter/创建提交。 */
export function CreateGroupPopover({
  t,
  onCreate,
}: {
  t: (key: string) => string;
  onCreate: (name: string, color: string) => void;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [color, setColor] = useState<string>("gray");
  const submit = (): void => {
    onCreate(name.trim() || t("sidebar.group.namePlaceholder"), color);
    setOpen(false);
    setName("");
    setColor("gray");
  };
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      side="bottom"
      align="end"
      contentClassName="w-56 p-3"
      trigger={
        <button
          type="button"
          aria-label={t("sidebar.group.create")}
          title={t("sidebar.group.create")}
          className="hover:text-(--color-foreground)"
        >
          <Hash size={14} />
        </button>
      }
    >
      <input
        autoFocus
        value={name}
        onChange={(event) => setName(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") submit();
        }}
        placeholder={t("sidebar.group.namePlaceholder")}
        aria-label={t("sidebar.group.namePlaceholder")}
        className="h-8 w-full rounded-md border border-(--color-border) bg-(--color-surface) px-2.5 outline-none text-(--color-foreground) placeholder:text-(--color-faint) focus:border-(--color-accent)"
      />
      <div className="mt-3 mb-1 text-(--color-faint)">{t("sidebar.group.color")}</div>
      <ul>
        {GROUP_COLORS.map((id) => (
          <li key={id}>
            <button
              type="button"
              onClick={() => setColor(id)}
              aria-pressed={color === id}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-(--color-foreground) hover:bg-(--color-hover)"
            >
              <span className="size-2.5 shrink-0 rounded-full" style={{ background: groupColorVar(id) }} aria-hidden />
              {t(`sidebar.group.color.${id}`)}
              {color === id && <Check size={13} className="ml-auto shrink-0 text-(--color-accent)" />}
            </button>
          </li>
        ))}
      </ul>
      <div className="mt-3 flex justify-end">
        <button
          type="button"
          onClick={submit}
          className="h-8 rounded-md bg-(--color-brand) px-3 text-(--color-inverse) transition-opacity hover:opacity-80"
        >
          {t("sidebar.group.create")}
        </button>
      </div>
    </Popover>
  );
}

export function GroupsView({
  t,
  groups,
  sessions,
  archived,
  pinned = {},
  unread = {},
  activeId,
  runningIds,
  collapsed,
  onToggleCollapsed,
  onSelect,
  onArchive,
  groupActions,
}: {
  t: (key: string) => string;
  groups: readonly SidebarGroup[];
  sessions: Session[];
  archived: Readonly<Record<string, boolean>>;
  /** 置顶标记（组内/未分组区内稳定排前 + 行首 Pin 图标）。 */
  pinned?: Readonly<Record<string, boolean>>;
  unread?: Readonly<Record<string, boolean>>;
  activeId: string | null;
  runningIds?: ReadonlySet<string>;
  collapsed: ReadonlySet<string>;
  onToggleCollapsed: (id: string) => void;
  onSelect: (id: string) => void;
  onArchive: (id: string) => void;
  groupActions?: GroupActions;
}): React.JSX.Element {
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const byId = useMemo(() => new Map(sessions.map((session) => [session.id, session])), [sessions]);
  const visible = (id: string): Session | null => {
    const session = byId.get(id);
    return session && archived[session.id] !== true ? session : null;
  };
  const groupedIds = new Set(groups.flatMap((group) => group.sessionIds));
  const ungrouped = pinnedFirst(
    sessions.filter((session) => !groupedIds.has(session.id) && archived[session.id] !== true),
    pinned,
  );

  /** HTML5 DnD：dragover 放行 + 放置高亮；drop 移动归属。 */
  const allowDrop = (target: string) => (event: React.DragEvent) => {
    if (!event.dataTransfer.types.includes("text/plain")) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setDropTarget(target);
  };
  const handleDrop = (target: string) => (event: React.DragEvent) => {
    event.preventDefault();
    setDropTarget(null);
    const id = event.dataTransfer.getData("text/plain");
    if (id) groupActions?.moveSession(id, target === "__ungrouped__" ? null : target);
  };

  return (
    <>
      {groups.map((group) => {
        const members = pinnedFirst(
          group.sessionIds.map(visible).filter((session): session is Session => session !== null),
          pinned,
        );
        const isCollapsed = collapsed.has(group.id);
        return (
          <section
            key={group.id}
            onDragOver={allowDrop(group.id)}
            onDragLeave={() => setDropTarget((current) => (current === group.id ? null : current))}
            onDrop={handleDrop(group.id)}
            className={`mb-1 rounded-md ${dropTarget === group.id ? "bg-(--color-selected)" : ""}`}
          >
            <div className="group flex items-center gap-1 rounded-md px-1.5 py-1">
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
              <Hash size={13} className="shrink-0" style={{ color: groupColorVar(group.color) }} aria-hidden />
              <span className="truncate font-medium text-(--color-foreground)">{group.name}</span>
              {groupActions && (
                <span className="ml-auto flex items-center opacity-0 transition-opacity group-hover:opacity-100 motion-reduce:transition-none">
                  <button
                    type="button"
                    onClick={() => groupActions.newSessionInGroup(group.id)}
                    aria-label={t("sidebar.group.newSession")}
                    title={t("sidebar.group.newSession")}
                    className="rounded p-0.5 text-(--color-muted) hover:text-(--color-foreground)"
                  >
                    <Plus size={13} />
                  </button>
                  <button
                    type="button"
                    onClick={() => groupActions.deleteGroup(group.id)}
                    aria-label={t("sidebar.group.delete")}
                    title={t("sidebar.group.delete")}
                    className="rounded p-0.5 text-(--color-muted) hover:text-(--color-tool-err)"
                  >
                    <Trash2 size={13} />
                  </button>
                </span>
              )}
              <button
                type="button"
                onClick={() => onToggleCollapsed(group.id)}
                aria-expanded={!isCollapsed}
                aria-label={isCollapsed ? t("sidebar.expand") : t("sidebar.collapse")}
                title={isCollapsed ? t("sidebar.expand") : t("sidebar.collapse")}
                className="rounded p-0.5 text-(--color-muted) opacity-0 transition-opacity hover:text-(--color-foreground) group-hover:opacity-100 motion-reduce:transition-none"
              >
                {isCollapsed ? <ChevronDown size={13} /> : <ChevronUp size={13} />}
              </button>
            </div>
            {!isCollapsed &&
              (members.length === 0 ? (
                groupActions ? (
                  <button
                    type="button"
                    onClick={() => groupActions.newSessionInGroup(group.id)}
                    className="mx-1.5 flex w-[calc(100%-12px)] items-center justify-center rounded-md border border-dashed border-(--color-border) px-2 py-1.5 text-(--color-faint) hover:border-(--color-border-hover) hover:text-(--color-muted)"
                  >
                    {t("sidebar.group.empty")}
                  </button>
                ) : null
              ) : (
                <ul className="ml-3 space-y-px border-l border-(--color-border) pl-2">
                  {members.map((session) => (
                    <SessionRow
                      key={session.id}
                      t={t}
                      session={session}
                      active={session.id === activeId}
                      running={runningIds?.has(session.id) === true}
                      pinned={pinned[session.id] === true}
                      unread={unread[session.id] === true}
                      onSelect={onSelect}
                      onArchive={onArchive}
                      archiveLabel={t("sidebar.archive")}
                      draggable
                      onMoveToTop={groupActions ? (id) => groupActions.moveToTop(group.id, id) : undefined}
                      onRemoveFromGroup={groupActions ? (id) => groupActions.moveSession(id, null) : undefined}
                    />
                  ))}
                </ul>
              ))}
          </section>
        );
      })}
      {/* 未分组：平铺无节头；整区是「移出分组」放置区。 */}
      <div
        onDragOver={allowDrop("__ungrouped__")}
        onDragLeave={() => setDropTarget((current) => (current === "__ungrouped__" ? null : current))}
        onDrop={handleDrop("__ungrouped__")}
        className={`rounded-md ${dropTarget === "__ungrouped__" ? "bg-(--color-selected)" : ""}`}
      >
        <ul className="space-y-px">
          {ungrouped.map((session) => (
            <SessionRow
              key={session.id}
              t={t}
              session={session}
              active={session.id === activeId}
              running={runningIds?.has(session.id) === true}
              pinned={pinned[session.id] === true}
              unread={unread[session.id] === true}
              onSelect={onSelect}
              onArchive={onArchive}
              archiveLabel={t("sidebar.archive")}
              draggable
            />
          ))}
        </ul>
      </div>
      {groups.length === 0 && ungrouped.length === 0 && (
        <div className="px-2 py-3 text-center text-(--color-muted)">{t("sidebar.empty")}</div>
      )}
    </>
  );
}
