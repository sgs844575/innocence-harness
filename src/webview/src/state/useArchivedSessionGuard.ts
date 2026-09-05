// 活动会话归档守卫：活动会话的归档标记一旦为真，立即清空活动会话回到落地态。
// 归档来源不止侧栏行按钮（还有启动自动归档与重启回放），标题栏菜单的命令式
// 离开只覆盖自己那一条路，这里以不变量兜底——主区与 lastSessionId 恢复都不
// 停留在已归档任务上。
import { useEffect } from "react";

/** leave 需为稳定引用（App 传 sessions.newSession）。 */
export function useArchivedSessionGuard(
  activeId: string | null,
  archived: Readonly<Record<string, boolean>>,
  leave: () => void,
): void {
  useEffect(() => {
    if (activeId !== null && archived[activeId] === true) leave();
  }, [activeId, archived, leave]);
}
