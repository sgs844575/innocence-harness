// 子代理运行面板的数据源（纯模块，可单测）：把 subagent:lifecycle 事件流折叠成
// 按 childId 索引的运行记录——delta 累加为 text、thinkingDelta/tool/textSegment
// 载荷按事件顺序追加 entries 对话时间线（思考/正文段被工具活动打断即分段）、
// 终态记 endedAt。进程内实况（子会话随跑随弃，不持久化）。
import type { SubagentLifecycleEvent, SubagentStatus } from "../../../shared/ipc";

export interface SubagentRunTool {
  name: string;
  phase: "call" | "result";
  isError?: boolean;
  /** Call 阶段的参数摘要（文件名/模式/命令首行）。 */
  title?: string;
  /** Call 阶段的参数有界投影（供复现主时间线工具行格式）。 */
  args?: Record<string, unknown>;
  /** Result 阶段的输出摘录（有界）。 */
  result?: string;
  at: number;
}

/** 对话时间线条目：一段思考文本、一段已闭合正文、一次工具活动（call/result
 *  各自成条）或一条续跑 prompt（resume 重开时追加，与初始 prompt 同形态展示）。 */
export type SubagentRunEntry =
  | { kind: "prompt"; text: string }
  | { kind: "thinking"; text: string }
  | { kind: "text"; text: string }
  | { kind: "tool"; tool: SubagentRunTool };

export interface SubagentRun {
  childId: string;
  parentSessionId: string;
  /** 派生它的 Task 调用 id（关联时间线工具行）。 */
  parentInvocationId?: string;
  agentType?: string;
  description: string;
  prompt?: string;
  status: SubagentStatus;
  /** 运行中累加的子代理文本输出（含已闭合段与未闭合流式尾部）。 */
  text: string;
  /** 已闭合正文段（textSegment）的累计长度：run.text.slice(0, closedTextLength)
   *  已入 entries 的 text 条目，slice 之后是未闭合的流式尾部。 */
  closedTextLength?: number;
  /** 对话时间线（按事件顺序）：思考/正文段与工具活动穿插成段。 */
  entries: SubagentRunEntry[];
  final?: string;
  error?: string;
  startedAt: number;
  endedAt?: number;
}

export type SubagentRunsState = Readonly<Record<string, SubagentRun>>;

export const initialSubagentRunsState: SubagentRunsState = {};

const TERMINAL: ReadonlySet<SubagentStatus> = new Set(["completed", "failed", "cancelled"]);

/** 事件 → 对话时间线：thinkingDelta/textSegment 只延续紧邻的同类条目（其余
 *  任何事件都已把末位换走，天然分段）；tool 载荷按 call/result 独立成条追加。
 *  thinkingSegment（段落闭合事件，落盘）与实况 thinkingDelta 去重：delta 已把
 *  同一段推理累积成紧邻的思考条目时（等长同文 = 同一段）不重复落条；回放流
 *  没有 delta，闭合段直接落成新条目。 */
function applyRunEntries(
  entries: SubagentRunEntry[],
  event: SubagentLifecycleEvent,
  at: number,
): SubagentRunEntry[] {
  let next = entries;
  if (event.thinkingDelta) {
    const last = entries[entries.length - 1];
    next =
      last?.kind === "thinking"
        ? [...entries.slice(0, -1), { kind: "thinking", text: last.text + event.thinkingDelta }]
        : [...entries, { kind: "thinking", text: event.thinkingDelta }];
  }
  if (event.thinkingSegment) {
    const last = next[next.length - 1];
    if (!(last?.kind === "thinking" && last.text === event.thinkingSegment)) {
      next = [...next, { kind: "thinking", text: event.thinkingSegment }];
    }
  }
  if (event.textSegment) {
    const last = next[next.length - 1];
    next =
      last?.kind === "text"
        ? [...next.slice(0, -1), { kind: "text", text: last.text + event.textSegment }]
        : [...next, { kind: "text", text: event.textSegment }];
  }
  if (event.tool) {
    next = [...next, { kind: "tool", tool: { ...event.tool, at } }];
  }
  return next;
}

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
      entries: [],
      startedAt: at,
    };
    return { ...state, [event.childId]: run };
  }
  // 重放的 started 对已建档运行是幂等空操作；终态档案只被 resume 重开事件
  // （resumed running）拉回运行，其余迟到事件一律忽略。
  if (existing.endedAt !== undefined) {
    if (event.status !== "running" || event.resumed !== true) return state;
    const run: SubagentRun = {
      ...existing,
      status: "running",
      endedAt: undefined,
      final: undefined,
      error: undefined,
      // 续跑 prompt 追加为时间线条目（初始 prompt 仍在 run.prompt 独立渲染）。
      entries: event.prompt
        ? [...existing.entries, { kind: "prompt", text: event.prompt } as const]
        : existing.entries,
      ...(event.parentInvocationId ? { parentInvocationId: event.parentInvocationId } : {}),
    };
    return { ...state, [event.childId]: run };
  }
  if (event.status === "started") return state;
  const next: SubagentRun = {
    ...existing,
    status: event.status,
    text: event.delta ? existing.text + event.delta : existing.text,
    ...(event.textSegment
      ? { closedTextLength: (existing.closedTextLength ?? 0) + event.textSegment.length }
      : {}),
    entries: applyRunEntries(existing.entries, event, at),
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

/** 分组视图：存活（started/running）一组、已结束（completed/failed/cancelled，
 *  即「已完成」大类，失败/取消在组内以各自状态标出）一组；两组各自按创建
 *  时间倒序（新→旧）。不改动入参数组。 */
export interface SubagentRunGroups {
  running: SubagentRun[];
  completed: SubagentRun[];
}

export function groupRunsByLiveness(runs: readonly SubagentRun[]): SubagentRunGroups {
  const running: SubagentRun[] = [];
  const completed: SubagentRun[] = [];
  for (const run of runs) {
    if (run.status === "started" || run.status === "running") running.push(run);
    else completed.push(run);
  }
  const byNewest = (a: SubagentRun, b: SubagentRun): number => b.startedAt - a.startedAt;
  running.sort(byNewest);
  completed.sort(byNewest);
  return { running, completed };
}

/** 按 Task 调用 id 反查运行（时间线工具行 → 面板卡片）。限定会话：旧档案的
 *  关联键可能与其他会话撞键（重启前生成的 id），不按会话过滤会开错会话记录。 */
export function runByInvocation(
  state: SubagentRunsState,
  sessionId: string | null,
  invocationId: string,
): SubagentRun | undefined {
  if (sessionId === null) return undefined;
  return Object.values(state).find(
    (run) => run.parentSessionId === sessionId && run.parentInvocationId === invocationId,
  );
}

/** 时间线 Task 工具行的定位线索：关联键（新记录）、行标题（= Task 调用的
 *  description，即运行的 description）、工具结果文本（= 运行的 final）。 */
export interface TaskRowClue {
  invocationId?: string;
  title?: string;
  resultText?: string;
}

/** 把 Task 工具行解析为唯一运行：关联键优先；无键（重启前的旧记录）或键失
 *  配时按标题在本会话内精确匹配，重名时用结果文本（= run.final）消歧。只在
 *  唯一确定时返回——重名又无结果文本可辨时宁可让调用方落归档列表，也不猜
 *  错记录。 */
export function runForTaskRow(
  state: SubagentRunsState,
  sessionId: string | null,
  clue: TaskRowClue,
): SubagentRun | undefined {
  if (sessionId === null) return undefined;
  if (clue.invocationId !== undefined) {
    const byKey = runByInvocation(state, sessionId, clue.invocationId);
    if (byKey) return byKey;
  }
  if (clue.title === undefined || clue.title === "") return undefined;
  const byTitle = runsForSession(state, sessionId).filter((run) => run.description === clue.title);
  if (byTitle.length === 1) return byTitle[0];
  if (byTitle.length > 1 && clue.resultText !== undefined && clue.resultText !== "") {
    const byFinal = byTitle.filter((run) => run.final !== undefined && run.final === clue.resultText);
    if (byFinal.length === 1) return byFinal[0];
  }
  return undefined;
}

/** 回放过滤：内存已有档案的 childId 不回放（实况优先，历史不覆盖）。 */
export function filterHydrationEntries(
  state: SubagentRunsState,
  entries: readonly { at: number; event: SubagentLifecycleEvent }[],
): { at: number; event: SubagentLifecycleEvent }[] {
  return entries.filter((entry) => state[entry.event.childId] === undefined);
}

/**
 * 回放折叠（复合 action 的 reducer 内实现，以最新 state 为准）：过滤 → 逐条
 * 归约 → 中断对账——回放建档后仍无终态的 run 必是上次进程退出时被打断
 *（落盘流以非终态收尾），补 cancelled 终态（时长锚在该流最后事件时刻），
 * 面板/胶囊不再出现永远转圈的幽灵运行。实况档案（回放前已存在）不动。
 */
export function hydrateSubagentRuns(
  state: SubagentRunsState,
  entries: readonly { at: number; event: SubagentLifecycleEvent }[],
): SubagentRunsState {
  const existingIds = new Set(Object.keys(state));
  const lastAt = new Map<string, number>();
  let next = filterHydrationEntries(state, entries).reduce((acc, entry) => {
    lastAt.set(entry.event.childId, Math.max(lastAt.get(entry.event.childId) ?? 0, entry.at));
    return reduceSubagentRuns(acc, entry.event, entry.at);
  }, state);
  for (const [childId, run] of Object.entries(next)) {
    if (existingIds.has(childId) || run.endedAt !== undefined) continue;
    next = reduceSubagentRuns(
      next,
      { childId, parentSessionId: run.parentSessionId, description: "", status: "cancelled" },
      lastAt.get(childId) ?? run.startedAt,
    );
  }
  return next;
}

/** 运行时长 mm:ss（运行中传 now 取活值，终态传 endedAt 定值）。 */
export function formatRunDuration(startedAt: number, end: number): string {
  const total = Math.max(0, Math.round((end - startedAt) / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/** 面板工具轨迹行：call/result 按名配对，call 无后续 result = 进行中；
 *  result 的摘录与错误态并回同一行（展开详情用）；call 的 args 有界投影
 *  随行携带（复现主时间线富工具行用，旧档案无此字段则退化为简版行）。 */
export interface SubagentRunToolRow {
  name: string;
  done: boolean;
  isError?: boolean;
  title?: string;
  args?: Record<string, unknown>;
  result?: string;
  at: number;
}

export function pairedRunTools(tools: readonly SubagentRunTool[]): SubagentRunToolRow[] {
  const rows: SubagentRunToolRow[] = [];
  for (const tool of tools) {
    if (tool.phase === "call") {
      rows.push({
        name: tool.name,
        done: false,
        ...(tool.title ? { title: tool.title } : {}),
        ...(tool.args ? { args: tool.args } : {}),
        at: tool.at,
      });
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

/** 渲染分段：续跑 prompt、思考段、正文段与「连续工具条目」组成的工具组按
 *  事件顺序交替——思考/正文被工具活动打断即成独立段落，工具不跨段合组。 */
export type SubagentRunChunk =
  | { kind: "prompt"; text: string }
  | { kind: "thinking"; text: string }
  | { kind: "text"; text: string }
  | { kind: "tools"; tools: SubagentRunTool[] };

export function runConversationChunks(entries: readonly SubagentRunEntry[]): SubagentRunChunk[] {
  const chunks: SubagentRunChunk[] = [];
  for (const entry of entries) {
    if (entry.kind === "thinking" || entry.kind === "prompt") {
      chunks.push({ kind: entry.kind, text: entry.text });
      continue;
    }
    if (entry.kind === "text") {
      const last = chunks[chunks.length - 1];
      if (last?.kind === "text") last.text += entry.text;
      else chunks.push({ kind: "text", text: entry.text });
      continue;
    }
    const last = chunks[chunks.length - 1];
    if (last?.kind === "tools") last.tools.push(entry.tool);
    else chunks.push({ kind: "tools", tools: [entry.tool] });
  }
  return chunks;
}
