// 侧栏树（纯函数，可单测）：项目视图按 workspaceRoot 聚合会话，
// 归档会话剔除；排序按项目最近活跃，项目内按会话 updatedAt 倒序；
// 置顶会话在各分区内稳定排前（pinnedFirst）。
import type { Session } from "../../../shared/ipc";
import { projectName } from "./useSessions";

/** 置顶优先的稳定分区：保持两侧各自的原有相对顺序。 */
export function pinnedFirst<T extends { id: string }>(
  items: readonly T[],
  pinned: Readonly<Record<string, boolean>>,
): T[] {
  const top = items.filter((item) => pinned[item.id] === true);
  return top.length === 0 ? [...items] : [...top, ...items.filter((item) => pinned[item.id] !== true)];
}

export interface ProjectNode {
  /** 项目根路径；空串 = 不在项目中。 */
  id: string;
  name: string;
  sessions: Session[];
}

export function buildProjectTree(
  sessions: readonly Session[],
  archived: Readonly<Record<string, boolean>>,
  noProjectLabel: string,
  pinned: Readonly<Record<string, boolean>> = {},
): ProjectNode[] {
  const byRoot = new Map<string, Session[]>();
  for (const session of sessions) {
    if (archived[session.id] === true) continue;
    const root = session.workspaceRoot?.trim() ?? "";
    const list = byRoot.get(root) ?? [];
    list.push(session);
    byRoot.set(root, list);
  }
  return [...byRoot.entries()]
    .map(([root, list]) => ({
      id: root,
      name: root === "" ? noProjectLabel : projectName(root),
      sessions: pinnedFirst(list.sort((a, b) => b.updatedAt - a.updatedAt), pinned),
      latest: Math.max(...list.map((s) => s.updatedAt)),
    }))
    .sort((a, b) => b.latest - a.latest)
    .map(({ id, name, sessions: nodeSessions }) => ({ id, name, sessions: nodeSessions }));
}

/** 会话运行状态投影（侧栏行图标）：流式中的会话集合由 App 层维护。 */
export type SidebarSessionStatus = "running" | "idle";
