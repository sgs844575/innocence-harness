// 子代理运行订阅：常驻监听 subagent:lifecycle（主进程全局广播），折叠进
// reducer；面板读取时按会话过滤。桥缺失（测试/纯浏览器）时不订阅。
// hydrate 支持重启后按会话回放落盘档案（at 走记录内的真实时间轴）。
import { useCallback, useEffect, useReducer } from "react";
import type { SubagentLifecycleEvent } from "../../../shared/ipc";
import { api, hasBridge } from "../lib/ipc";
import {
  hydrateSubagentRuns,
  initialSubagentRunsState,
  reduceSubagentRuns,
  type SubagentRunsState,
} from "./subagentRuns";

/** 实况事件（+可选落盘时间轴，缺省取当前时刻）或一批回放记录。 */
type RunsAction =
  | (SubagentLifecycleEvent & { at?: number })
  | { hydrate: readonly { at: number; event: SubagentLifecycleEvent }[] };

export interface SubagentRunsController {
  state: SubagentRunsState;
  /** 回放落盘档案（内存已有档案的 childId 跳过，实况优先）。 */
  hydrate(entries: readonly { at: number; event: SubagentLifecycleEvent }[]): void;
}

export function useSubagentRuns(
  onStarted?: (event: SubagentLifecycleEvent) => void,
): SubagentRunsController {
  // 复合 action 在 reducer 内部完成回放折叠（hydrateSubagentRuns：过滤 +
  // 归约 + 中断对账，以 reducer 的 current 为准——hydrate 闭包里的 state 是
  // 渲染快照，批处理下会过期）。
  const [state, dispatch] = useReducer(
    (current: SubagentRunsState, action: RunsAction): SubagentRunsState =>
      "hydrate" in action ? hydrateSubagentRuns(current, action.hydrate) : reduceSubagentRuns(current, action, action.at ?? Date.now()),
    initialSubagentRunsState,
  );
  const hydrate = useCallback((entries: readonly { at: number; event: SubagentLifecycleEvent }[]) => {
    if (entries.length > 0) dispatch({ hydrate: entries });
  }, []);

  useEffect(() => {
    if (!hasBridge()) return;
    const unsubscribe = api.onSubagentLifecycle((event) => {
      dispatch(event);
      if (event.status === "started") onStarted?.(event);
    });
    return unsubscribe;
  }, []);

  return { state, hydrate };
}
