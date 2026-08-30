// S2a 工作树会话判定（纯函数，Electron-free）：任务路由会话是否运行在
// 宿主管理的工作树中。键于持久身份而非字符串不等式——恢复路径的
// userWorkspaceRoot 来自 git toplevel，子目录工作区/大小写差异会让字符串
// 比较误报（复审 P1 教训）；这里用 ①任务模式 isolated 或 ②有效根位于任务
// 工作树存储目录 之下判定，两者皆与恢复/重建无关地稳定。
import path from "node:path";

/** taskRuntimeBridge.getRoute 的句柄形状（结构性：测试可造伪句柄）。 */
export interface WorktreeSessionHandle {
  mode?: string;
  workspaceRoot?: string;
}

/**
 * 任务路由会话是否运行在宿主管理的工作树中。
 * @param handle 路由句柄（live-map 缺失 = undefined → 非工作树）
 * @param worktreeStorageRoot 任务工作树存储目录（<taskStorageDir>/worktrees）
 */
export function isWorktreeSession(
  handle: WorktreeSessionHandle | undefined,
  worktreeStorageRoot: string,
): boolean {
  if (!handle?.workspaceRoot) return false;
  if (handle.mode === "isolated") return true;
  const root = path.normalize(worktreeStorageRoot);
  const effective = path.normalize(handle.workspaceRoot);
  return effective === root || effective.startsWith(root + path.sep);
}
