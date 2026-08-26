import type { Session } from "./ipc";

export const SidebarIpcChannels = {
  sidebarGet: "sidebar:get",
  sidebarChanged: "sidebar:changed",
  sidebarArchive: "sidebar:archive",
  sidebarReorder: "sidebar:reorder",
  sidebarMove: "sidebar:move",
  sidebarGroupUpsert: "sidebar:group-upsert",
  sidebarGroupDelete: "sidebar:group-delete",
  sidebarGroupCollapse: "sidebar:group-collapse",
} as const;

export interface SidebarGroup {
  id: string;
  name: string;
  collapsed: boolean;
  sessionIds: string[];
}

export interface SidebarProject {
  id: string;
  name: string;
  sessionIds: string[];
}

export interface SidebarState {
  version: 1;
  order: string[];
  archived: Record<string, boolean>;
  groups: SidebarGroup[];
  ungrouped: string[];
  projects: SidebarProject[];
}

export type SidebarGroupInput = {
  id: string;
  name: string;
  collapsed?: boolean;
  sessionIds?: string[];
};

export interface SidebarApi {
  getSidebarState(): Promise<SidebarState>;
  archiveSession(id: string, archived: boolean): Promise<void>;
  reorderSessions(groupId: string | null, orderedIds: string[]): Promise<void>;
  moveSession(id: string, targetGroupId: string | null, beforeId?: string): Promise<void>;
  upsertSidebarGroup(group: SidebarGroupInput): Promise<void>;
  deleteSidebarGroup(id: string): Promise<void>;
  setSidebarGroupCollapsed(id: string, collapsed: boolean): Promise<void>;
  onSidebarChanged(cb: (state: SidebarState) => void): () => void;
}

export function sidebarProjectForSession(state: SidebarState, session: Pick<Session, "id" | "workspaceRoot">): SidebarProject | undefined {
  const workspaceRoot = session.workspaceRoot ?? "";
  return workspaceRoot ? state.projects.find((project) => project.id === workspaceRoot) : undefined;
}
