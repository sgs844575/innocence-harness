// 侧栏持久状态：归档标记与分组（sidebar:* 通道）。分组突变（创建/移动/置顶）
// 写后主进程广播 sidebar:changed，本地状态经订阅刷新。
import { useCallback, useEffect, useRef, useState } from "react";
import type { SidebarGroup, SidebarState } from "../../../shared/sidebarIpc";
import { api, hasBridge } from "../lib/ipc";

export interface SidebarController {
  archived: Readonly<Record<string, boolean>>;
  groups: readonly SidebarGroup[];
  archive: (id: string) => Promise<void>;
  restore: (id: string) => Promise<void>;
  /** 新建分组（名称/颜色 id）。 */
  createGroup: (name: string, color: string) => Promise<void>;
  /** 移入分组；groupId = null 移出到未分组。 */
  moveSessionTo: (id: string, groupId: string | null) => Promise<void>;
  /** 组内置顶（重排该组 sessionIds 把会话放首位）。 */
  moveGroupSessionToTop: (groupId: string, sessionId: string) => Promise<void>;
  /** 删除分组（成员会话回落未分组）。 */
  deleteGroup: (id: string) => Promise<void>;
}

export function useSidebarState(): SidebarController {
  const [state, setState] = useState<SidebarState | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    if (!hasBridge()) return;
    void api.getSidebarState().then(setState).catch(() => undefined);
    return api.onSidebarChanged(setState);
  }, []);

  const archive = useCallback(async (id: string) => {
    await api.archiveSession(id, true).catch(() => undefined);
  }, []);

  const restore = useCallback(async (id: string) => {
    await api.archiveSession(id, false).catch(() => undefined);
  }, []);

  const createGroup = useCallback(async (name: string, color: string) => {
    await api
      .upsertSidebarGroup({ id: `grp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`, name, color })
      .catch(() => undefined);
  }, []);

  const moveSessionTo = useCallback(async (id: string, groupId: string | null) => {
    await api
      .moveSession(id, groupId === null ? { kind: "ungrouped" } : { kind: "group", groupId })
      .catch(() => undefined);
  }, []);

  const moveGroupSessionToTop = useCallback(async (groupId: string, sessionId: string) => {
    const group = stateRef.current?.groups.find((candidate) => candidate.id === groupId);
    if (!group || group.sessionIds[0] === sessionId) return;
    await api
      .reorderSessions(
        { kind: "group", groupId },
        [sessionId, ...group.sessionIds.filter((id) => id !== sessionId)],
      )
      .catch(() => undefined);
  }, []);

  const deleteGroup = useCallback(async (id: string) => {
    await api.deleteSidebarGroup(id).catch(() => undefined);
  }, []);

  return {
    archived: state?.archived ?? {},
    groups: state?.groups ?? [],
    archive,
    restore,
    createGroup,
    moveSessionTo,
    moveGroupSessionToTop,
    deleteGroup,
  };
}
