import fs from "node:fs";
import path from "node:path";
import type { Session } from "../shared/ipc";

export interface SidebarIndexGroup {
  id: string;
  name: string;
  collapsed: boolean;
  sessionIds: string[];
}

export interface SidebarIndexProject {
  id: string;
  name: string;
  sessionIds: string[];
}

export interface SidebarIndexDocument {
  version: 1;
  order: string[];
  archived: Record<string, boolean>;
  /** Custom group membership. Project membership is stored separately. */
  groups: SidebarIndexGroup[];
  /** Sessions without a custom group. */
  ungrouped: string[];
  /** Workspace/project membership is independent from custom groups. */
  projects: SidebarIndexProject[];
}

export interface SidebarState extends SidebarIndexDocument {
  /** Computed project tree, ordered by the persisted session order. */
  projects: SidebarIndexProject[];
}

type FileOps = Partial<Pick<typeof fs, "writeFileSync" | "renameSync" | "unlinkSync">>;

const DEFAULT_GROUP_COLLAPSED = false;

export function sidebarIndexFile(storeDir: string): string {
  return path.join(storeDir, "sidebar.json");
}

function projectName(workspaceRoot: string): string {
  return workspaceRoot.replace(/\\/g, "/").split("/").filter(Boolean).at(-1) ?? workspaceRoot;
}

function normalizeSessionIds(ids: readonly unknown[], validIds: ReadonlySet<string>): string[] {
  const seen = new Set<string>();
  return ids.filter((id): id is string => {
    if (typeof id !== "string" || !validIds.has(id) || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

function projectEntries(sessions: readonly Pick<Session, "id" | "workspaceRoot">[], order: readonly string[]): SidebarIndexProject[] {
  const byWorkspace = new Map<string, string[]>();
  const byId = new Map(sessions.map((session) => [session.id, session]));
  for (const id of order) {
    const session = byId.get(id);
    const workspace = session?.workspaceRoot ?? "";
    if (!session || workspace === "") continue;
    const ids = byWorkspace.get(workspace) ?? [];
    ids.push(id);
    byWorkspace.set(workspace, ids);
  }
  return [...byWorkspace].map(([id, sessionIds]) => ({ id, name: projectName(id), sessionIds }));
}

export function migrateLegacySessions(sessions: readonly Pick<Session, "id" | "workspaceRoot">[]): SidebarIndexDocument {
  const order = sessions.map(({ id }) => id);
  return {
    version: 1,
    order,
    archived: Object.fromEntries(order.map((id) => [id, false])),
    groups: [],
    ungrouped: [...order],
    projects: projectEntries(sessions, order),
  };
}

function normalizeDocument(value: unknown, sessions: readonly Pick<Session, "id" | "workspaceRoot">[]): SidebarIndexDocument | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Partial<SidebarIndexDocument>;
  if (input.version !== 1 || !Array.isArray(input.order)) return null;
  const validIds = new Set(sessions.map(({ id }) => id));
  const order = normalizeSessionIds(input.order, validIds);
  for (const { id } of sessions) if (!order.includes(id)) order.push(id);
  const archived: Record<string, boolean> = {};
  for (const id of order) archived[id] = input.archived?.[id] === true;

  const groups: SidebarIndexGroup[] = [];
  const grouped = new Set<string>();
  for (const group of Array.isArray(input.groups) ? input.groups : []) {
    if (!group || typeof group !== "object" || typeof group.id !== "string" || typeof group.name !== "string") continue;
    const sessionIds = normalizeSessionIds(Array.isArray(group.sessionIds) ? group.sessionIds : [], validIds)
      .filter((id) => !grouped.has(id));
    sessionIds.forEach((id) => grouped.add(id));
    groups.push({ id: group.id, name: group.name, collapsed: group.collapsed === true, sessionIds });
  }
  const ungrouped = order.filter((id) => !grouped.has(id));
  const projects = projectEntries(sessions, order);
  return { version: 1, order, archived, groups, ungrouped, projects };
}

export function loadSidebarIndex(
  file: string,
  sessions: readonly Pick<Session, "id" | "workspaceRoot">[],
): SidebarIndexDocument {
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      try { fs.renameSync(file, `${file}.corrupt-${Date.now()}`); } catch { /* recover with a fresh index */ }
    }
    return migrateLegacySessions(sessions);
  }
  const normalized = normalizeDocument(parsed, sessions);
  if (normalized) return normalized;
  try { fs.renameSync(file, `${file}.corrupt-${Date.now()}`); } catch { /* recover with a fresh index */ }
  const migrated = migrateLegacySessions(sessions);
  persistSidebarIndex(file, migrated);
  return migrated;
}

export function persistSidebarIndex(file: string, document: SidebarIndexDocument, ops: FileOps = fs): void {
  const tmp = `${file}.tmp`;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    ops.writeFileSync?.(tmp, JSON.stringify(document, null, 2), "utf8");
    if (!ops.writeFileSync || !ops.renameSync) return;
    ops.renameSync(tmp, file);
  } catch {
    try { ops.unlinkSync?.(tmp); } catch { /* keep the last good index */ }
  }
}

function cloneDocument(document: SidebarIndexDocument): SidebarIndexDocument {
  return {
    version: 1,
    order: [...document.order],
    archived: { ...document.archived },
    groups: document.groups.map((group) => ({ ...group, sessionIds: [...group.sessionIds] })),
    ungrouped: [...document.ungrouped],
    projects: document.projects.map((project) => ({ ...project, sessionIds: [...project.sessionIds] })),
  };
}

export interface SidebarIndexStore {
  getSidebarState(): SidebarState;
  replaceSessions(sessions: readonly Pick<Session, "id" | "workspaceRoot">[]): void;
  archiveSession(id: string, archived: boolean): void;
  reorderSessions(groupId: string | null, orderedIds: readonly string[]): void;
  moveSession(id: string, targetGroupId: string | null, beforeId?: string): void;
  upsertSidebarGroup(group: { id: string; name: string; collapsed?: boolean; sessionIds?: readonly string[] }): void;
  deleteSidebarGroup(id: string): void;
  setSidebarGroupCollapsed(id: string, collapsed: boolean): void;
}

export function createSidebarIndexStore(
  storeDir: string,
  initialSessions: readonly Pick<Session, "id" | "workspaceRoot">[] = [],
): SidebarIndexStore {
  const file = sidebarIndexFile(storeDir);
  let sessionList = [...initialSessions];
  let document = loadSidebarIndex(file, sessionList);
  const validIds = () => new Set(sessionList.map(({ id }) => id));
  const persist = () => persistSidebarIndex(file, document);

  const replaceSessions = (nextSessions: readonly Pick<Session, "id" | "workspaceRoot">[]) => {
    sessionList = [...nextSessions];
    const valid = validIds();
    document.order = [...document.order.filter((id) => valid.has(id)), ...sessionList.map(({ id }) => id).filter((id) => !document.order.includes(id))];
    for (const id of document.order) document.archived[id] = document.archived[id] === true;
    document.groups = document.groups
      .map((group) => ({ ...group, sessionIds: group.sessionIds.filter((id) => valid.has(id)) }))
      .filter((group) => group.id.length > 0);
    const grouped = new Set(document.groups.flatMap((group) => group.sessionIds));
    document.ungrouped = document.order.filter((id) => !grouped.has(id));
    document.projects = projectEntries(sessionList, document.order);
    persist();
  };

  const mutate = (fn: () => void) => { fn(); persist(); };
  return {
    getSidebarState: () => cloneDocument(document),
    replaceSessions,
    archiveSession: (id, archived) => mutate(() => {
      if (validIds().has(id)) document.archived[id] = archived;
    }),
    reorderSessions: (groupId, orderedIds) => mutate(() => {
      const valid = validIds();
      const project = groupId === null
        ? document.projects.find((item) => {
            const candidate = new Set(item.sessionIds);
            return orderedIds.length > 0 && orderedIds.every((id) => candidate.has(id));
          })
        : undefined;
      const allowed = new Set(
        project
          ? project.sessionIds
          : groupId === null
            ? document.ungrouped
            : document.groups.find((group) => group.id === groupId)?.sessionIds ?? [],
      );
      const next = normalizeSessionIds(orderedIds, valid).filter((id) => allowed.has(id));
      const remainder = [...allowed].filter((id) => !next.includes(id));
      const merged = [...next, ...remainder];
      const selected = new Set(merged);
      let replacementIndex = 0;
      document.order = document.order.map((id) => selected.has(id) ? merged[replacementIndex++]! : id);
      if (groupId === null && !project) document.ungrouped = merged;
      else if (groupId !== null) {
        const group = document.groups.find((item) => item.id === groupId);
        if (group) group.sessionIds = merged;
      }
      document.projects = projectEntries(sessionList, document.order);
    }),
    moveSession: (id, targetGroupId, beforeId) => mutate(() => {
      if (!validIds().has(id)) return;
      for (const group of document.groups) group.sessionIds = group.sessionIds.filter((item) => item !== id);
      document.ungrouped = document.ungrouped.filter((item) => item !== id);
      const target = targetGroupId === null ? null : document.groups.find((group) => group.id === targetGroupId);
      const ids = target ? target.sessionIds : document.ungrouped;
      const at = beforeId ? ids.indexOf(beforeId) : -1;
      if (at < 0) ids.push(id); else ids.splice(at, 0, id);
      document.order = [...ids, ...document.order.filter((item) => item !== id && !ids.includes(item))];
      document.projects = projectEntries(sessionList, document.order);
    }),
    upsertSidebarGroup: (group) => mutate(() => {
      const existing = document.groups.find((item) => item.id === group.id);
      if (existing) {
        existing.name = group.name;
        existing.collapsed = group.collapsed ?? existing.collapsed;
        if (group.sessionIds) {
          const nextIds = normalizeSessionIds(group.sessionIds, validIds());
          for (const item of document.groups) {
            if (item !== existing) item.sessionIds = item.sessionIds.filter((id) => !nextIds.includes(id));
          }
          document.ungrouped = document.ungrouped.filter((id) => !nextIds.includes(id));
          existing.sessionIds = nextIds;
        }
        return;
      }
      const sessionIds = normalizeSessionIds(group.sessionIds ?? [], validIds());
      for (const item of document.groups) item.sessionIds = item.sessionIds.filter((id) => !sessionIds.includes(id));
      document.ungrouped = document.ungrouped.filter((id) => !sessionIds.includes(id));
      document.groups.push({ id: group.id, name: group.name, collapsed: group.collapsed ?? DEFAULT_GROUP_COLLAPSED, sessionIds });
    }),
    deleteSidebarGroup: (id) => mutate(() => {
      const index = document.groups.findIndex((group) => group.id === id);
      if (index < 0) return;
      const [removed] = document.groups.splice(index, 1);
      document.ungrouped.push(...(removed?.sessionIds ?? []).filter((sessionId) => !document.ungrouped.includes(sessionId)));
    }),
    setSidebarGroupCollapsed: (id, collapsed) => mutate(() => {
      const group = document.groups.find((item) => item.id === id);
      if (group) group.collapsed = collapsed;
    }),
  };
}
