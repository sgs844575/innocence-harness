import type { Session } from "../../../../shared/ipc";
import type { SidebarState } from "../../../../shared/sidebarIpc";

export type SidebarView = "projects" | "groups";

export interface SidebarTreeNode {
  id: string;
  name: string;
  sessionIds: string[];
  collapsed: boolean;
  kind: "project" | "group" | "ungrouped";
}

export function buildSidebarTree(
  sessions: readonly Session[],
  state: SidebarState,
  view: SidebarView,
  unassignedName: string,
): SidebarTreeNode[] {
  const byId = new Map(sessions.map((session) => [session.id, session]));
  const order = new Map(state.order.map((id, index) => [id, index]));
  const sortIds = (ids: readonly string[], preserveInput = false) => {
    const filtered = [...ids].filter((id) => byId.has(id));
    return preserveInput ? filtered : filtered.sort((a, b) => (order.get(a) ?? Number.MAX_SAFE_INTEGER) - (order.get(b) ?? Number.MAX_SAFE_INTEGER));
  };
  if (view === "projects") {
    const nodes: SidebarTreeNode[] = state.projects.map((project) => ({ id: project.id, name: project.name, sessionIds: sortIds(project.sessionIds), collapsed: false, kind: "project" }));
    const assigned = new Set(state.projects.flatMap((project) => project.sessionIds));
    const ungrouped = sortIds(state.order.filter((id) => !assigned.has(id)));
    if (ungrouped.length) nodes.push({ id: "__project-unassigned__", name: unassignedName, sessionIds: ungrouped, collapsed: false, kind: "ungrouped" });
    return nodes;
  }
  const nodes: SidebarTreeNode[] = state.groups.map((group) => ({ id: group.id, name: group.name, sessionIds: sortIds(group.sessionIds, true), collapsed: group.collapsed, kind: "group" }));
  const assigned = new Set(state.groups.flatMap((group) => group.sessionIds));
  const ungrouped = sortIds(state.ungrouped.filter((id) => !assigned.has(id)));
  if (ungrouped.length) nodes.push({ id: "__sidebar-ungrouped__", name: unassignedName, sessionIds: ungrouped, collapsed: false, kind: "ungrouped" });
  return nodes;
}
