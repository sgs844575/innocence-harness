// 聊天列与浮动胶囊的布局规则（纯函数，可单测）：
// 对齐解包规格的容器断点——会话容器 ≥1280px 时右侧预留 337px
// （319px 胶囊 + 18px 右缘）把内容列向左挤；默认窗口（1280 宽，容器约
// 1015px）与胶囊折叠为小图标时不挤压，胶囊悬浮在内容之上。
export const CAPSULE_RESERVE = 337;
export const CAPSULE_SQUEEZE_MIN_WIDTH = 1280;

export function capsuleRightGutter(containerWidth: number, capsuleOpen: boolean): number {
  if (!capsuleOpen) return 0;
  return containerWidth >= CAPSULE_SQUEEZE_MIN_WIDTH ? CAPSULE_RESERVE : 0;
}

/** 胶囊可见性（默认不出现）：本项目是 Git 仓库 / 已有待办清单 /
 *  存在子代理运行（存活或已结束任一）/ 存在存活终端——任一成立即出现。 */
export function capsuleHasContent(data: {
  isGitRepo: boolean;
  todos: readonly unknown[];
  subagents?: { running: readonly unknown[]; completed?: readonly unknown[] };
  terminals?: { count: number };
}): boolean {
  return (
    data.isGitRepo ||
    data.todos.length > 0 ||
    (data.subagents ? data.subagents.running.length + (data.subagents.completed?.length ?? 0) > 0 : false) ||
    (data.terminals?.count ?? 0) > 0
  );
}
