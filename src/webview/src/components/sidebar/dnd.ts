import type { SidebarContainer, SidebarState } from "../../../../shared/sidebarIpc";
import type { SidebarView } from "./viewModel";

export type SidebarDragCommand =
  | { type: "move-session"; id: string; target: SidebarContainer; beforeId?: string }
  | { type: "reorder-containers"; kind: "projects" | "groups"; orderedIds: string[] };

function containerForSession(state: SidebarState, view: SidebarView, sessionId: string): SidebarContainer | null {
  if (view === "projects") {
    const project = state.projects.find((item) => item.sessionIds.includes(sessionId));
    return project ? { kind: "project", projectId: project.id } : null;
  }
  const group = state.groups.find((item) => item.sessionIds.includes(sessionId));
  return group ? { kind: "group", groupId: group.id } : { kind: "ungrouped" };
}

function idsForContainer(state: SidebarState, container: SidebarContainer): string[] {
  if (container.kind === "project") return state.projects.find((item) => item.id === container.projectId)?.sessionIds ?? [];
  if (container.kind === "group") return state.groups.find((item) => item.id === container.groupId)?.sessionIds ?? [];
  return state.ungrouped;
}

function reorder(ids: readonly string[], active: string, over: string): string[] {
  const next = ids.filter((id) => id !== active);
  const index = next.indexOf(over);
  if (index < 0) return [...next, active];
  next.splice(index, 0, active);
  return next;
}

export function resolveSidebarDrag(
  state: SidebarState,
  view: SidebarView,
  activeId: string,
  overId: string,
  filtered = false,
): SidebarDragCommand | null {
  if (filtered || activeId === overId) return null;
  if (activeId.startsWith("header:") && overId.startsWith("header:")) {
    const kind = view === "projects" ? "projects" : "groups";
    const ids = kind === "projects" ? state.projects.map((item) => item.id) : state.groups.map((item) => item.id);
    return { type: "reorder-containers", kind, orderedIds: reorder(ids, activeId.slice(7), overId.slice(7)) };
  }
  if (!activeId.startsWith("session:")) return null;
  const id = activeId.slice(8);
  let target: SidebarContainer | null = null;
  let beforeId: string | undefined;
  if (overId.startsWith("session:")) {
    beforeId = overId.slice(8);
    target = containerForSession(state, view, beforeId);
  } else if (overId === "container:ungrouped" && view === "groups") {
    target = { kind: "ungrouped" };
  } else if (overId.startsWith("header:") && view === "groups") {
    const groupId = overId.slice(7);
    if (state.groups.some((group) => group.id === groupId)) target = { kind: "group", groupId };
  } else if (overId.startsWith("header:") && view === "projects") {
    const projectId = overId.slice(7);
    if (state.projects.some((project) => project.id === projectId)) target = { kind: "project", projectId };
  }
  if (!target) return null;
  const ids = idsForContainer(state, target);
  if (beforeId === id) return null;
  return { type: "move-session", id, target, ...(beforeId && ids.includes(beforeId) ? { beforeId } : {}) };
}
