// 子代理运行面板的数据源（纯模块，可单测）：把 subagent:lifecycle 事件流折叠成
// 按 childId 索引的运行记录——delta 累加为 text、tool 载荷追加 tools 轨迹、
// 终态记 endedAt。进程内实况（子会话随跑随弃，不持久化）。
import type { SubagentLifecycleEvent, SubagentStatus } from "../../../shared/ipc";

export interface SubagentRunTool {
  name: string;
  phase: "call" | "result";
  isError?: boolean;
  /** Call 阶段的参数摘要（文件名/模式/命令首行）。 */
  title?: string;
  /** Result 阶段的输出摘录（有界）。 */
  result?: string;
  at: number;
}

export interface SubagentRun {
  childId: string;
  parentSessionId: string;
  /** 派生它的 Task 调用 id（关联时间线工具行）。 */
  parentInvocationId?: string;
  agentType?: string;
  description: string;
  prompt?: string;
  status: SubagentStatus;
  /** 运行中累加的子代理文本输出。 */
  text: string;
  tools: SubagentRunTool[];
  final?: string;
  error?: string;
  startedAt: number;
  endedAt?: number;
}

export type SubagentRunsState = Readonly<Record<string, SubagentRun>>;

export const initialSubagentRunsState: SubagentRunsState = {};

const TERMINAL: ReadonlySet<SubagentStatus> = new Set(["completed", "failed", "cancelled"]);

export function reduceSubagentRuns(
  state: SubagentRunsState,
  event: SubagentLifecycleEvent,
  at: number = Date.now(),
): SubagentRunsState {
  const existing = state[event.childId];
  if (!existing) {
    // 面板从 started 起建档；started 之前/之外的迟到事件无档可落，忽略。
    if (event.status !== "started") return state;
    const run: SubagentRun = {
      childId: event.childId,
      parentSessionId: event.parentSessionId,
      ...(event.parentInvocationId ? { parentInvocationId: event.parentInvocationId } : {}),
      ...(event.agentType ? { agentType: event.agentType } : {}),
      description: event.description,
      ...(event.prompt ? { prompt: event.prompt } : {}),
      status: event.status,
      text: "",
      tools: [],
      startedAt: at,
    };
    return { ...state, [event.childId]: run };
  }
  // 终态之后不再有更新（spawner 保证终态唯一，这里再兜一层）。
  if (existing.endedAt !== undefined) return state;
  const next: SubagentRun = {
    ...existing,
    status: event.status,
    text: event.delta ? existing.text + event.delta : existing.text,
    tools: event.tool ? [...existing.tools, { ...event.tool, at }] : existing.tools,
    ...(event.final !== undefined ? { final: event.final } : {}),
    ...(event.error !== undefined ? { error: event.error } : {}),
    ...(TERMINAL.has(event.status) ? { endedAt: at } : {}),
  };
  return { ...state, [event.childId]: next };
}

/** 一个会话的运行列表（按开始时间升序）。 */
export function runsForSession(state: SubagentRunsState, sessionId: string | null): SubagentRun[] {
  if (sessionId === null) return [];
  return Object.values(state)
    .filter((run) => run.parentSessionId === sessionId)
    .sort((a, b) => a.startedAt - b.startedAt);
}

/** 按 Task 调用 id 反查运行（时间线工具行 → 面板卡片）。 */
export function runByInvocation(state: SubagentRunsState, invocationId: string): SubagentRun | undefined {
  return Object.values(state).find((run) => run.parentInvocationId === invocationId);
}

/** 运行时长 mm:ss（运行中传 now 取活值，终态传 endedAt 定值）。 */
export function formatRunDuration(startedAt: number, end: number): string {
  const total = Math.max(0, Math.round((end - startedAt) / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/** 面板工具轨迹行：call/result 按名配对，call 无后续 result = 进行中；
 *  result 的摘录与错误态并回同一行（展开详情用）。 */
export interface SubagentRunToolRow {
  name: string;
  done: boolean;
  isError?: boolean;
  title?: string;
  result?: string;
  at: number;
}

export function pairedRunTools(tools: readonly SubagentRunTool[]): SubagentRunToolRow[] {
  const rows: SubagentRunToolRow[] = [];
  for (const tool of tools) {
    if (tool.phase === "call") {
      rows.push({ name: tool.name, done: false, ...(tool.title ? { title: tool.title } : {}), at: tool.at });
      continue;
    }
    const open = [...rows].reverse().find((row) => !row.done && row.name === tool.name);
    if (open) {
      open.done = true;
      open.isError = tool.isError;
      if (tool.result) open.result = tool.result;
    } else {
      rows.push({
        name: tool.name,
        done: true,
        ...(tool.isError ? { isError: true } : {}),
        ...(tool.result ? { result: tool.result } : {}),
        at: tool.at,
      });
    }
  }
  return rows;
}
