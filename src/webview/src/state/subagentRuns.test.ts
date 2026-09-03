import { describe, expect, it } from "vitest";
import type { SubagentLifecycleEvent } from "../../../shared/ipc";
import {
  filterHydrationEntries,
  formatRunDuration,
  hydrateSubagentRuns,
  initialSubagentRunsState,
  pairedRunTools,
  reduceSubagentRuns,
  runByInvocation,
  runsForSession,
  type SubagentRunsState,
} from "./subagentRuns";

const started: SubagentLifecycleEvent = {
  childId: "c1",
  parentSessionId: "s1",
  description: "定位渲染",
  status: "started",
  agentType: "explore",
  prompt: "去查",
  parentInvocationId: "inv-1",
};

describe("reduceSubagentRuns", () => {
  it("started 建档：预设/prompt/关联键入档，文本与工具轨迹为空", () => {
    const state = reduceSubagentRuns(initialSubagentRunsState, started, 1000);
    expect(state["c1"]).toMatchObject({
      childId: "c1",
      parentSessionId: "s1",
      parentInvocationId: "inv-1",
      agentType: "explore",
      prompt: "去查",
      status: "started",
      text: "",
      tools: [],
      startedAt: 1000,
    });
  });

  it("忽略陌生 childId 的非 started 迟到事件", () => {
    const state = reduceSubagentRuns(initialSubagentRunsState, {
      childId: "ghost",
      parentSessionId: "s1",
      description: "",
      status: "running",
      delta: "x",
    });
    expect(state).toEqual({});
  });

  it("running 事件累加文本、追加工具轨迹", () => {
    let state: SubagentRunsState = reduceSubagentRuns(initialSubagentRunsState, started, 1000);
    state = reduceSubagentRuns(state, { childId: "c1", parentSessionId: "s1", description: "", status: "running" }, 1100);
    state = reduceSubagentRuns(state, { childId: "c1", parentSessionId: "s1", description: "", status: "running", delta: "正在" }, 1200);
    state = reduceSubagentRuns(state, { childId: "c1", parentSessionId: "s1", description: "", status: "running", delta: "读取", tool: { name: "Read", phase: "call" } }, 1300);
    state = reduceSubagentRuns(state, { childId: "c1", parentSessionId: "s1", description: "", status: "running", tool: { name: "Read", phase: "result", isError: false } }, 1400);
    expect(state["c1"]).toMatchObject({ status: "running", text: "正在读取" });
    expect(state["c1"]!.tools).toEqual([
      { name: "Read", phase: "call", at: 1300 },
      { name: "Read", phase: "result", isError: false, at: 1400 },
    ]);
  });

  it("工具轨迹携带参数摘要与结果摘录", () => {
    let state: SubagentRunsState = reduceSubagentRuns(initialSubagentRunsState, started, 1000);
    state = reduceSubagentRuns(state, { childId: "c1", parentSessionId: "s1", description: "", status: "running", tool: { name: "Grep", phase: "call", title: "pairedRunTools" } }, 1300);
    state = reduceSubagentRuns(state, { childId: "c1", parentSessionId: "s1", description: "", status: "running", tool: { name: "Grep", phase: "result", isError: true, result: "无匹配" } }, 1400);
    expect(state["c1"]!.tools).toEqual([
      { name: "Grep", phase: "call", title: "pairedRunTools", at: 1300 },
      { name: "Grep", phase: "result", isError: true, result: "无匹配", at: 1400 },
    ]);
  });

  it("终态记 endedAt 与 final/error，之后的事件不再改动", () => {
    let state: SubagentRunsState = reduceSubagentRuns(initialSubagentRunsState, started, 1000);
    state = reduceSubagentRuns(state, { childId: "c1", parentSessionId: "s1", description: "", status: "completed", final: "报告" }, 5000);
    expect(state["c1"]).toMatchObject({ status: "completed", final: "报告", endedAt: 5000 });
    const after = reduceSubagentRuns(state, { childId: "c1", parentSessionId: "s1", description: "", status: "running", delta: "迟到" }, 6000);
    expect(after).toBe(state);
  });

  it("重放的 started 对已建档运行是幂等空操作（不重置状态/时间轴）", () => {
    let state: SubagentRunsState = reduceSubagentRuns(initialSubagentRunsState, started, 1000);
    state = reduceSubagentRuns(state, { childId: "c1", parentSessionId: "s1", description: "", status: "completed", final: "报告" }, 5000);
    const replayed = reduceSubagentRuns(state, started, 9000);
    expect(replayed).toBe(state);
  });
});

describe("runsForSession / runByInvocation", () => {
  const state = [
    { ...started },
    { ...started, childId: "c2", parentSessionId: "s1", parentInvocationId: "inv-2", description: "另一个" },
    { ...started, childId: "c3", parentSessionId: "s2", parentInvocationId: "inv-3" },
  ].reduce<SubagentRunsState>(
    (acc, event, index) => reduceSubagentRuns(acc, event, 1000 + index * 100),
    initialSubagentRunsState,
  );

  it("按会话过滤并按开始时间升序", () => {
    expect(runsForSession(state, "s1").map((run) => run.childId)).toEqual(["c1", "c2"]);
    expect(runsForSession(state, null)).toEqual([]);
  });

  it("按 Task 调用 id 反查运行", () => {
    expect(runByInvocation(state, "inv-2")?.childId).toBe("c2");
    expect(runByInvocation(state, "inv-none")).toBeUndefined();
  });
});

describe("filterHydrationEntries", () => {
  it("内存已有档案的 childId 不回放（实况优先，历史终态不覆盖实况）", () => {
    const state = reduceSubagentRuns(initialSubagentRunsState, started, 1000);
    const entries = [
      { at: 1000, event: started },
      { at: 5000, event: { ...started, childId: "c2", status: "completed" as const, final: "另一报告" } },
    ];
    expect(filterHydrationEntries(state, entries)).toEqual([entries[1]]);
  });
});

describe("hydrateSubagentRuns", () => {
  it("完整事件流回放建档（终态原样），实况档案不被历史覆盖", () => {
    const live = reduceSubagentRuns(initialSubagentRunsState, { ...started, childId: "live" }, 900);
    const state = hydrateSubagentRuns(live, [
      { at: 1000, event: started },
      { at: 5000, event: { childId: "c1", parentSessionId: "s1", description: "", status: "completed", final: "报告" } },
    ]);
    expect(state["c1"]).toMatchObject({ status: "completed", final: "报告", endedAt: 5000 });
    expect(state["live"]).toBe(live["live"]);
  });

  it("以非终态收尾的流（进程退出时中断）对账为 cancelled，锚定最后事件时刻", () => {
    const state = hydrateSubagentRuns(initialSubagentRunsState, [
      { at: 1000, event: started },
      { at: 1300, event: { childId: "c1", parentSessionId: "s1", description: "", status: "running", tool: { name: "Read", phase: "call" } } },
    ]);
    expect(state["c1"]).toMatchObject({ status: "cancelled", endedAt: 1300 });
  });
});

describe("pairedRunTools", () => {
  it("call/result 按名配对；无结果的 call 保持进行中", () => {
    const rows = pairedRunTools([
      { name: "Read", phase: "call", at: 1 },
      { name: "Grep", phase: "call", at: 2 },
      { name: "Read", phase: "result", isError: false, at: 3 },
      { name: "Grep", phase: "result", isError: true, at: 4 },
    ]);
    expect(rows).toEqual([
      { name: "Read", done: true, isError: false, at: 1 },
      { name: "Grep", done: true, isError: true, at: 2 },
    ]);
    expect(pairedRunTools([{ name: "Read", phase: "call", at: 1 }])[0]).toMatchObject({ done: false });
  });

  it("call 的摘要保留在行上；result 的摘录并回同一行", () => {
    const rows = pairedRunTools([
      { name: "Grep", phase: "call", title: "pairedRunTools", at: 1 },
      { name: "Grep", phase: "result", isError: true, result: "无匹配", at: 2 },
    ]);
    expect(rows).toEqual([
      { name: "Grep", done: true, isError: true, title: "pairedRunTools", result: "无匹配", at: 1 },
    ]);
  });

  it("迟到 result（无未决 call）单独立行", () => {
    const rows = pairedRunTools([{ name: "Read", phase: "result", isError: false, result: "内容", at: 9 }]);
    expect(rows).toEqual([{ name: "Read", done: true, result: "内容", at: 9 }]);
  });
});

describe("formatRunDuration", () => {
  it("mm:ss 格式", () => {
    expect(formatRunDuration(1000, 1000)).toBe("0:00");
    expect(formatRunDuration(1000, 66_200)).toBe("1:05");
  });
});
