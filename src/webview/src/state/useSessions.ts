// 会话列表控制器：列表/选择/新建/删除与落地态项目选择。
// 新建 ≠ 创建——落地态只是回到无会话，首条消息发送时才 createSession。
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Session } from "../../../shared/ipc";
import { api, hasBridge } from "../lib/ipc";

export interface RecentProject {
  path: string;
  count: number;
}

export interface SessionsController {
  sessions: Session[];
  activeId: string | null;
  /** 落地态选中的项目根（"" = 不在项目中）。 */
  pendingProject: string;
  recentProjects: RecentProject[];
  selectSession: (id: string) => void;
  newSession: () => void;
  deleteSession: (id: string) => Promise<void>;
  setPendingProject: (root: string) => void;
  /** 弹出目录选择；返回选中的目录（取消 → ""），选中即设为落地态项目。 */
  pickProjectDir: () => Promise<string>;
  /** 发送前的会话保证：有激活会话直接用，否则按落地态项目创建。 */
  ensureSessionForSend: () => Promise<string>;
}

export function projectName(root: string): string {
  return root.split(/[\\/]/).filter(Boolean).pop() ?? root;
}

/** dock 辅助对话会话不进侧边栏列表与项目统计（dock 自管理其生命周期）。 */
export function withoutAuxSessions(list: Session[]): Session[] {
  return list.filter((session) => session.aux !== true);
}

export function useSessions(): SessionsController {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [pendingProject, setPendingProject] = useState("");
  const activeIdRef = useRef<string | null>(null);
  activeIdRef.current = activeId;
  const pendingProjectRef = useRef(pendingProject);
  pendingProjectRef.current = pendingProject;

  useEffect(() => {
    if (!hasBridge()) return;
    void api.listSessions().then((list) => setSessions(withoutAuxSessions(list))).catch(() => undefined);
    const off = api.onSessionsChanged((list) => setSessions(withoutAuxSessions(list)));
    return off;
  }, []);

  const selectSession = useCallback((id: string) => setActiveId(id), []);
  const newSession = useCallback(() => setActiveId(null), []);

  const deleteSession = useCallback(
    async (id: string) => {
      await api.deleteSession(id);
      if (activeIdRef.current === id) setActiveId(null);
    },
    [],
  );

  const pickProjectDir = useCallback(async () => {
    const dir = await api.pickWorkspace();
    if (dir) setPendingProject(dir);
    return dir;
  }, []);

  const ensureSessionForSend = useCallback(async (): Promise<string> => {
    const current = activeIdRef.current;
    if (current !== null) return current;
    const root = pendingProjectRef.current.trim();
    const session = await api.createSession(root ? { workspaceRoot: root } : undefined);
    setActiveId(session.id);
    return session.id;
  }, []);

  const recentProjects = useMemo<RecentProject[]>(() => {
    const byRoot = new Map<string, { count: number; latest: number }>();
    for (const session of sessions) {
      const root = session.workspaceRoot?.trim();
      if (!root) continue;
      const entry = byRoot.get(root) ?? { count: 0, latest: 0 };
      entry.count += 1;
      entry.latest = Math.max(entry.latest, session.updatedAt);
      byRoot.set(root, entry);
    }
    return [...byRoot.entries()]
      .sort((a, b) => b[1].latest - a[1].latest)
      .slice(0, 5)
      .map(([path, entry]) => ({ path, count: entry.count }));
  }, [sessions]);

  return {
    sessions,
    activeId,
    pendingProject,
    recentProjects,
    selectSession,
    newSession,
    deleteSession,
    setPendingProject,
    pickProjectDir,
    ensureSessionForSend,
  };
}
