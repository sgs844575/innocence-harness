import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { SidebarContainer } from "../shared/sidebarIpc";
import type { Session } from "../shared/ipc";

export interface SidebarIndexGroup {
  id: string;
  name: string;
  collapsed: boolean;
  sessionIds: string[];
  /** 分组颜色 id（缺省 gray；旧文档无此键）。 */
  color?: string;
}

export interface SidebarIndexProject {
  /** Opaque, deterministic ID. Workspace paths never leave the main process. */
  id: string;
  name: string;
  sessionIds: string[];
}

export interface SidebarIndexDocument {
  version: 1;
  /** Authoritative session-store order; defaults follow this order. */
  order: string[];
  archived: Record<string, boolean>;
  groups: SidebarIndexGroup[];
  ungrouped: string[];
  projectOrder: string[];
  manualProjectOrders: Record<string, string[]>;
  manualUngrouped: boolean;
  /** Derived projection, written for recovery compatibility only. */
  projects: SidebarIndexProject[];
}

export interface SidebarState extends SidebarIndexDocument {}

export interface SidebarFileOps {
  mkdirSync: typeof fs.mkdirSync;
  readFileSync: typeof fs.readFileSync;
  writeFileSync: typeof fs.writeFileSync;
  renameSync: typeof fs.renameSync;
  unlinkSync: typeof fs.unlinkSync;
}

export class SidebarPersistenceError extends Error {
  constructor() {
    super("sidebar state was not saved");
    this.name = "SidebarPersistenceError";
  }
}

export class SidebarValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SidebarValidationError";
  }
}

const DEFAULT_GROUP_COLLAPSED = false;
const defaultFileOps: SidebarFileOps = {
  mkdirSync: fs.mkdirSync,
  readFileSync: fs.readFileSync,
  writeFileSync: fs.writeFileSync,
  renameSync: fs.renameSync,
  unlinkSync: fs.unlinkSync,
};

type SessionProjection = Pick<Session, "id" | "workspaceRoot">;

export function sidebarIndexFile(storeDir: string): string {
  return path.join(storeDir, "sidebar.json");
}

/** Converts a main-only workspace root to a stable renderer-safe identifier. */
export function sidebarProjectId(workspaceRoot: string): string {
  return `project_${createHash("sha256").update(workspaceRoot).digest("hex").slice(0, 20)}`;
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

function mergeKnownOrder(existing: readonly string[], next: readonly string[]): string[] {
  const allowed = new Set(next);
  return [...existing.filter((id) => allowed.has(id)), ...next.filter((id) => !existing.includes(id))];
}

function mergeManualOrder(manual: readonly string[], baseline: readonly string[]): string[] {
  const allowed = new Set(baseline);
  const orderedManual = manual.filter((id) => allowed.has(id));
  const manuallyPlaced = new Set(orderedManual);
  let replacementIndex = 0;
  return baseline.map((id) => manuallyPlaced.has(id) ? orderedManual[replacementIndex++]! : id);
}

function projectEntries(
  sessions: readonly SessionProjection[],
  order: readonly string[],
  projectOrder: readonly string[],
  manualProjectOrders: Readonly<Record<string, readonly string[]>>,
): SidebarIndexProject[] {
  const byWorkspace = new Map<string, string[]>();
  const byId = new Map(sessions.map((session) => [session.id, session]));
  for (const id of order) {
    const session = byId.get(id);
    const workspaceRoot = session?.workspaceRoot ?? "";
    if (!session || workspaceRoot === "") continue;
    const ids = byWorkspace.get(workspaceRoot) ?? [];
    ids.push(id);
    byWorkspace.set(workspaceRoot, ids);
  }
  const entries = [...byWorkspace].map(([workspaceRoot, baseline]) => {
    const id = sidebarProjectId(workspaceRoot);
    const manual = manualProjectOrders[id] ?? [];
    return { id, name: projectName(workspaceRoot), sessionIds: mergeManualOrder(manual, baseline) };
  });
  const position = new Map(projectOrder.map((id, index) => [id, index]));
  entries.sort((left, right) => (position.get(left.id) ?? Number.MAX_SAFE_INTEGER) - (position.get(right.id) ?? Number.MAX_SAFE_INTEGER));
  return entries;
}

function effectiveProjects(document: SidebarIndexDocument, sessions: readonly SessionProjection[]): SidebarIndexProject[] {
  return projectEntries(sessions, document.order, document.projectOrder, document.manualProjectOrders);
}

function cloneDocument(document: SidebarIndexDocument): SidebarIndexDocument {
  return {
    version: 1,
    order: [...document.order],
    archived: { ...document.archived },
    groups: document.groups.map((group) => ({ ...group, sessionIds: [...group.sessionIds] })),
    ungrouped: [...document.ungrouped],
    projectOrder: [...document.projectOrder],
    manualProjectOrders: Object.fromEntries(Object.entries(document.manualProjectOrders).map(([id, ids]) => [id, [...ids]])),
    manualUngrouped: document.manualUngrouped,
    projects: document.projects.map((project) => ({ ...project, sessionIds: [...project.sessionIds] })),
  };
}

function refreshProjection(document: SidebarIndexDocument, sessions: readonly SessionProjection[]): void {
  document.projects = effectiveProjects(document, sessions);
  const knownProjectIds = new Set(document.projects.map((project) => project.id));
  document.projectOrder = mergeKnownOrder(document.projectOrder.filter((id) => knownProjectIds.has(id)), document.projects.map((project) => project.id));
}

function normalizeDocument(value: unknown, sessions: readonly SessionProjection[]): SidebarIndexDocument | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Partial<SidebarIndexDocument>;
  if (input.version !== 1 || !Array.isArray(input.order)) return null;
  const validIds = new Set(sessions.map(({ id }) => id));
  const order = mergeKnownOrder(normalizeSessionIds(input.order, validIds), sessions.map(({ id }) => id));
  const archived = Object.fromEntries(order.map((id) => [id, input.archived?.[id] === true]));
  const grouped = new Set<string>();
  const groups: SidebarIndexGroup[] = [];
  for (const group of Array.isArray(input.groups) ? input.groups : []) {
    if (!group || typeof group !== "object" || typeof group.id !== "string" || typeof group.name !== "string") continue;
    const sessionIds = normalizeSessionIds(Array.isArray(group.sessionIds) ? group.sessionIds : [], validIds).filter((id) => !grouped.has(id));
    sessionIds.forEach((id) => grouped.add(id));
    groups.push({
      id: group.id,
      name: group.name,
      collapsed: group.collapsed === true,
      sessionIds,
      ...(typeof group.color === "string" && group.color.trim() !== "" ? { color: group.color } : {}),
    });
  }
  const manualUngrouped = input.manualUngrouped === true;
  const ungroupedSeed = manualUngrouped && Array.isArray(input.ungrouped)
    ? normalizeSessionIds(input.ungrouped, validIds).filter((id) => !grouped.has(id))
    : order.filter((id) => !grouped.has(id));
  const manualProjectOrders: Record<string, string[]> = {};
  if (input.manualProjectOrders && typeof input.manualProjectOrders === "object") {
    for (const [projectId, ids] of Object.entries(input.manualProjectOrders)) {
      if (Array.isArray(ids)) manualProjectOrders[projectId] = normalizeSessionIds(ids, validIds);
    }
  }
  const document: SidebarIndexDocument = {
    version: 1,
    order,
    archived,
    groups,
    ungrouped: ungroupedSeed,
    projectOrder: Array.isArray(input.projectOrder) ? input.projectOrder.filter((id): id is string => typeof id === "string") : [],
    manualProjectOrders,
    manualUngrouped,
    projects: [],
  };
  refreshProjection(document, sessions);
  return document;
}

export function migrateLegacySessions(sessions: readonly SessionProjection[]): SidebarIndexDocument {
  const order = sessions.map(({ id }) => id);
  const document: SidebarIndexDocument = {
    version: 1,
    order,
    archived: Object.fromEntries(order.map((id) => [id, false])),
    groups: [],
    ungrouped: [...order],
    projectOrder: [],
    manualProjectOrders: {},
    manualUngrouped: false,
    projects: [],
  };
  refreshProjection(document, sessions);
  return document;
}

export function persistSidebarIndex(file: string, document: SidebarIndexDocument, ops: Partial<SidebarFileOps> = defaultFileOps): boolean {
  const fileOps = { ...defaultFileOps, ...ops };
  const tmp = `${file}.tmp`;
  try {
    fileOps.mkdirSync(path.dirname(file), { recursive: true });
    fileOps.writeFileSync(tmp, JSON.stringify(document, null, 2), "utf8");
    fileOps.renameSync(tmp, file);
    return true;
  } catch {
    try { fileOps.unlinkSync(tmp); } catch { /* retain prior complete document */ }
    return false;
  }
}

export function loadSidebarIndex(file: string, sessions: readonly SessionProjection[], ops: Partial<SidebarFileOps> = defaultFileOps): SidebarIndexDocument {
  const fileOps = { ...defaultFileOps, ...ops };
  try {
    const normalized = normalizeDocument(JSON.parse(fileOps.readFileSync(file, "utf8")), sessions);
    if (normalized) return normalized;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return migrateLegacySessions(sessions);
  }
  try { fileOps.renameSync(file, `${file}.corrupt-${Date.now()}`); } catch { /* begin from the legacy projection */ }
  return migrateLegacySessions(sessions);
}

export interface SidebarIndexStore {
  getSidebarState(): SidebarState;
  replaceSessions(sessions: readonly SessionProjection[]): void;
  archiveSession(id: string, archived: boolean): void;
  reorderSessions(container: SidebarContainer, orderedIds: readonly string[]): void;
  moveSession(id: string, target: SidebarContainer, beforeId?: string): void;
  reorderContainers(kind: "projects" | "groups", orderedIds: readonly string[]): void;
  upsertSidebarGroup(group: { id: string; name: string; collapsed?: boolean; sessionIds?: readonly string[]; color?: string }): void;
  deleteSidebarGroup(id: string): void;
  setSidebarGroupCollapsed(id: string, collapsed: boolean): void;
}

export function createSidebarIndexStore(
  storeDir: string,
  initialSessions: readonly SessionProjection[] = [],
  options: { ops?: Partial<SidebarFileOps> } = {},
): SidebarIndexStore {
  const file = sidebarIndexFile(storeDir);
  const ops = { ...defaultFileOps, ...options.ops };
  let sessionList = [...initialSessions];
  let document = loadSidebarIndex(file, sessionList, ops);
  const validIds = () => new Set(sessionList.map(({ id }) => id));

  const commit = (change: (staged: SidebarIndexDocument) => void): void => {
    const staged = cloneDocument(document);
    change(staged);
    refreshProjection(staged, sessionList);
    if (!persistSidebarIndex(file, staged, ops)) throw new SidebarPersistenceError();
    document = staged;
  };

  const validateFullOrder = (orderedIds: readonly string[], expected: readonly string[], what: string): string[] => {
    const normalized = [...new Set(orderedIds.filter((id): id is string => typeof id === "string"))];
    if (normalized.length !== expected.length || normalized.some((id) => !expected.includes(id))) {
      throw new SidebarValidationError(`invalid ${what} order`);
    }
    return normalized;
  };

  return {
    getSidebarState: () => cloneDocument(document),
    replaceSessions: (nextSessions) => {
      const nextList = [...nextSessions];
      const previousList = sessionList;
      sessionList = nextList;
      try {
        commit((staged) => {
          const valid = validIds();
          const authoritative = nextList.map(({ id }) => id);
          staged.order = authoritative;
          staged.archived = Object.fromEntries(authoritative.map((id) => [id, staged.archived[id] === true]));
          staged.groups = staged.groups.map((group) => ({ ...group, sessionIds: group.sessionIds.filter((id) => valid.has(id)) }));
          const grouped = new Set(staged.groups.flatMap((group) => group.sessionIds));
          const ungroupedBaseline = authoritative.filter((id) => !grouped.has(id));
          staged.ungrouped = staged.manualUngrouped
            ? mergeManualOrder(staged.ungrouped.filter((id) => !grouped.has(id)), ungroupedBaseline)
            : ungroupedBaseline;
          for (const [projectId, ids] of Object.entries(staged.manualProjectOrders)) {
            staged.manualProjectOrders[projectId] = ids.filter((id) => valid.has(id));
          }
        });
      } catch (error) {
        sessionList = previousList;
        throw error;
      }
    },
    archiveSession: (id, archived) => commit((staged) => {
      if (!validIds().has(id)) throw new SidebarValidationError("unknown session");
      staged.archived[id] = archived;
    }),
    reorderSessions: (container, orderedIds) => commit((staged) => {
      const projects = effectiveProjects(staged, sessionList);
      if (container.kind === "project") {
        const project = projects.find((item) => item.id === container.projectId);
        if (!project) throw new SidebarValidationError("unknown project container");
        staged.manualProjectOrders[container.projectId] = validateFullOrder(orderedIds, project.sessionIds, "project session");
        return;
      }
      if (container.kind === "group") {
        const group = staged.groups.find((item) => item.id === container.groupId);
        if (!group) throw new SidebarValidationError("unknown group container");
        group.sessionIds = validateFullOrder(orderedIds, group.sessionIds, "group session");
        return;
      }
      staged.ungrouped = validateFullOrder(orderedIds, staged.ungrouped, "ungrouped session");
      staged.manualUngrouped = true;
    }),
    moveSession: (id, target, beforeId) => commit((staged) => {
      if (!validIds().has(id)) throw new SidebarValidationError("unknown session");
      const insertBefore = (ids: string[]) => {
        const without = ids.filter((item) => item !== id);
        if (beforeId === undefined) return [...without, id];
        const index = without.indexOf(beforeId);
        if (index < 0) throw new SidebarValidationError("before session is outside target container");
        without.splice(index, 0, id);
        return without;
      };
      if (target.kind === "project") {
        const projects = effectiveProjects(staged, sessionList);
        const targetProject = projects.find((project) => project.id === target.projectId);
        const sourceProject = projects.find((project) => project.sessionIds.includes(id));
        if (!targetProject || sourceProject?.id !== targetProject.id) throw new SidebarValidationError("cannot move a session across projects");
        staged.manualProjectOrders[target.projectId] = insertBefore(targetProject.sessionIds);
        return;
      }
      for (const group of staged.groups) group.sessionIds = group.sessionIds.filter((item) => item !== id);
      staged.ungrouped = staged.ungrouped.filter((item) => item !== id);
      if (target.kind === "group") {
        const group = staged.groups.find((item) => item.id === target.groupId);
        if (!group) throw new SidebarValidationError("unknown group container");
        group.sessionIds = insertBefore(group.sessionIds);
        return;
      }
      staged.ungrouped = insertBefore(staged.ungrouped);
      staged.manualUngrouped = true;
    }),
    reorderContainers: (kind, orderedIds) => commit((staged) => {
      if (kind === "groups") {
        const ids = validateFullOrder(orderedIds, staged.groups.map((group) => group.id), "group");
        const byId = new Map(staged.groups.map((group) => [group.id, group]));
        staged.groups = ids.map((id) => byId.get(id)!);
        return;
      }
      const projectIds = effectiveProjects(staged, sessionList).map((project) => project.id);
      staged.projectOrder = validateFullOrder(orderedIds, projectIds, "project");
    }),
    upsertSidebarGroup: (group) => commit((staged) => {
      if (!group.id || !group.name.trim()) throw new SidebarValidationError("invalid group");
      const existing = staged.groups.find((item) => item.id === group.id);
      const ids = group.sessionIds ? normalizeSessionIds(group.sessionIds, validIds()) : undefined;
      if (ids) {
        for (const item of staged.groups) if (item !== existing) item.sessionIds = item.sessionIds.filter((id) => !ids.includes(id));
        staged.ungrouped = staged.ungrouped.filter((id) => !ids.includes(id));
      }
      if (existing) {
        existing.name = group.name;
        existing.collapsed = group.collapsed ?? existing.collapsed;
        if (group.color !== undefined) existing.color = group.color;
        if (ids) existing.sessionIds = ids;
        return;
      }
      staged.groups.push({
        id: group.id,
        name: group.name,
        collapsed: group.collapsed ?? DEFAULT_GROUP_COLLAPSED,
        sessionIds: ids ?? [],
        ...(group.color !== undefined ? { color: group.color } : {}),
      });
    }),
    deleteSidebarGroup: (id) => commit((staged) => {
      const index = staged.groups.findIndex((group) => group.id === id);
      if (index < 0) throw new SidebarValidationError("unknown group");
      const [removed] = staged.groups.splice(index, 1);
      staged.ungrouped = mergeKnownOrder(staged.ungrouped, removed!.sessionIds);
      staged.manualUngrouped = true;
    }),
    setSidebarGroupCollapsed: (id, collapsed) => commit((staged) => {
      const group = staged.groups.find((item) => item.id === id);
      if (!group) throw new SidebarValidationError("unknown group");
      group.collapsed = collapsed;
    }),
  };
}
