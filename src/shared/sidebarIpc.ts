export const SidebarIpcChannels = {
  sidebarGet: "sidebar:get",
  sidebarChanged: "sidebar:changed",
  sidebarArchive: "sidebar:archive",
  sidebarReorder: "sidebar:reorder",
  sidebarMove: "sidebar:move",
  sidebarContainersReorder: "sidebar:containers-reorder",
  sidebarGroupUpsert: "sidebar:group-upsert",
  sidebarGroupDelete: "sidebar:group-delete",
  sidebarGroupCollapse: "sidebar:group-collapse",
} as const;

export type SidebarContainer =
  | { kind: "project"; projectId: string }
  | { kind: "group"; groupId: string }
  | { kind: "ungrouped" };

export interface SidebarGroup {
  id: string;
  name: string;
  collapsed: boolean;
  sessionIds: string[];
}

export interface SidebarProject {
  /** Opaque ID resolved only by the main process. */
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
  projectOrder: string[];
  manualProjectOrders: Record<string, string[]>;
  manualUngrouped: boolean;
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
  reorderSessions(container: SidebarContainer, orderedIds: string[]): Promise<void>;
  moveSession(id: string, target: SidebarContainer, beforeId?: string): Promise<void>;
  reorderContainers(kind: "projects" | "groups", orderedIds: string[]): Promise<void>;
  upsertSidebarGroup(group: SidebarGroupInput): Promise<void>;
  deleteSidebarGroup(id: string): Promise<void>;
  setSidebarGroupCollapsed(id: string, collapsed: boolean): Promise<void>;
  onSidebarChanged(cb: (state: SidebarState) => void): () => void;
}
