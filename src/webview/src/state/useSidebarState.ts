import { useCallback, useEffect, useState } from "react";
import type { Session } from "../../../shared/ipc";
import type { SidebarGroupInput, SidebarState } from "../../../shared/sidebarIpc";
import { api } from "../lib/ipc";

const emptyState: SidebarState = { version: 1, order: [], archived: {}, groups: [], ungrouped: [], projects: [] };

export interface SidebarStateController {
  state: SidebarState;
  archiveSession: (id: string, archived: boolean) => Promise<void>;
  reorderSessions: (groupId: string | null, orderedIds: string[]) => Promise<void>;
  moveSession: (id: string, targetGroupId: string | null, beforeId?: string) => Promise<void>;
  upsertSidebarGroup: (group: SidebarGroupInput) => Promise<void>;
  deleteSidebarGroup: (id: string) => Promise<void>;
  setSidebarGroupCollapsed: (id: string, collapsed: boolean) => Promise<void>;
}

export function useSidebarState(sessions: readonly Session[]): SidebarStateController {
  const [state, setState] = useState<SidebarState>(emptyState);
  useEffect(() => {
    void api.getSidebarState().then(setState);
    return api.onSidebarChanged(setState);
  }, []);
  useEffect(() => {
    // Session changes can add/remove workspace projects while the index channel
    // remains compatible with existing session consumers.
    if (sessions.length === 0 && state.order.length === 0) return;
    void api.getSidebarState().then(setState);
  }, [sessions]);
  const archiveSession = useCallback((id: string, archived: boolean) => api.archiveSession(id, archived), []);
  const reorderSessions = useCallback((groupId: string | null, orderedIds: string[]) => api.reorderSessions(groupId, orderedIds), []);
  const moveSession = useCallback((id: string, targetGroupId: string | null, beforeId?: string) => api.moveSession(id, targetGroupId, beforeId), []);
  const upsertSidebarGroup = useCallback((group: SidebarGroupInput) => api.upsertSidebarGroup(group), []);
  const deleteSidebarGroup = useCallback((id: string) => api.deleteSidebarGroup(id), []);
  const setSidebarGroupCollapsed = useCallback((id: string, collapsed: boolean) => api.setSidebarGroupCollapsed(id, collapsed), []);
  return { state, archiveSession, reorderSessions, moveSession, upsertSidebarGroup, deleteSidebarGroup, setSidebarGroupCollapsed };
}
