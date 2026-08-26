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

export function archivedSessionIds(state: SidebarState, sessions: readonly Session[]): string[] {
  const valid = new Set(sessions.map((session) => session.id));
  return state.order.filter((id) => valid.has(id) && state.archived[id] === true);
}

export function buildSidebarTree(
  sessions: readonly Session[],
  state: SidebarState,
  view: SidebarView,
  unassignedName: string,
  collapsedProjectIds: readonly string[] = [],
): SidebarTreeNode[] {
  const archived = new Set(archivedSessionIds(state, sessions));
  const byId = new Map(sessions.filter((session) => !archived.has(session.id)).map((session) => [session.id, session]));
  const validIds = (ids: readonly string[]) => ids.filter((id) => byId.has(id));
  if (view === "projects") {
    const collapsedProjects = new Set(collapsedProjectIds);
    const nodes: SidebarTreeNode[] = state.projects.map((project) => ({ id: project.id, name: project.name, sessionIds: validIds(project.sessionIds), collapsed: collapsedProjects.has(project.id), kind: "project" }));
    const assigned = new Set(state.projects.flatMap((project) => project.sessionIds));
    const ungrouped = validIds(state.order.filter((id) => !assigned.has(id)));
    if (ungrouped.length) nodes.push({ id: "__project-unassigned__", name: unassignedName, sessionIds: ungrouped, collapsed: false, kind: "ungrouped" });
    return nodes;
  }
  const nodes: SidebarTreeNode[] = state.groups.map((group) => ({ id: group.id, name: group.name, sessionIds: validIds(group.sessionIds), collapsed: group.collapsed, kind: "group" }));
  const assigned = new Set(state.groups.flatMap((group) => group.sessionIds));
  const ungrouped = validIds(state.ungrouped.filter((id) => !assigned.has(id)));
  if (ungrouped.length) nodes.push({ id: "__sidebar-ungrouped__", name: unassignedName, sessionIds: ungrouped, collapsed: false, kind: "ungrouped" });
  return nodes;
}
