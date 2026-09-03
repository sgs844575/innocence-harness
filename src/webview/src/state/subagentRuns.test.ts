import { describe, expect, it } from "vitest";
import type { SubagentLifecycleEvent, SubagentStatus } from "../../../shared/ipc";
import {
  filterHydrationEntries,
  formatRunDuration,
  groupRunsByLiveness,
  hydrateSubagentRuns,
  initialSubagentRunsState,
  pairedRunTools,
  reduceSubagentRuns,
  runByInvocation,
  runConversationChunks,
  runForTaskRow,
  runsForSession,
  type SubagentRun,
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
  it("started 建档：预设/prompt/关联键入档，文本与对话时间线为空", () => {
    const state = reduceSubagentRuns(initialSubagentRunsState, started, 1000);
    expect(state["c1"]).toMatchObject({
      childId: "c1",
      parentSessionId: "s1",
      parentInvocationId: "inv-1",
      agentType: "explore",
      prompt: "去查",
      status: "started",
      text: "",
      entries: [],
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

  it("running 事件累加文本、追加工具条目", () => {
    let state: SubagentRunsState = reduceSubagentRuns(initialSubagentRunsState, started, 1000);
    state = reduceSubagentRuns(state, { childId: "c1", parentSessionId: "s1", description: "", status: "running" }, 1100);
    state = reduceSubagentRuns(state, { childId: "c1", parentSessionId: "s1", description: "", status: "running", delta: "正在" }, 1200);
    state = reduceSubagentRuns(state, { childId: "c1", parentSessionId: "s1", description: "", status: "running", delta: "读取", tool: { name: "Read", phase: "call" } }, 1300);
    state = reduceSubagentRuns(state, { childId: "c1", parentSessionId: "s1", description: "", status: "running", tool: { name: "Read", phase: "result", isError: false } }, 1400);
    expect(state["c1"]).toMatchObject({ status: "running", text: "正在读取" });
    expect(state["c1"]!.entries).toEqual([
      { kind: "tool", tool: { name: "Read", phase: "call", at: 1300 } },
      { kind: "tool", tool: { name: "Read", phase: "result", isError: false, at: 1400 } },
    ]);
  });

  it("工具条目携带参数摘要与结果摘录；call 的 args 有界投影保留", () => {
    let state: SubagentRunsState = reduceSubagentRuns(initialSubagentRunsState, started, 1000);
    state = reduceSubagentRuns(state, { childId: "c1", parentSessionId: "s1", description: "", status: "running", tool: { name: "Grep", phase: "call", title: "pairedRunTools" } }, 1300);
    state = reduceSubagentRuns(state, { childId: "c1", parentSessionId: "s1", description: "", status: "running", tool: { name: "Grep", phase: "result", isError: true, result: "无匹配" } }, 1400);
    state = reduceSubagentRuns(state, { childId: "c1", parentSessionId: "s1", description: "", status: "running", tool: { name: "Edit", phase: "call", title: "a.ts", args: { file_path: "src/a.ts", old_string: "a", new_string: "b" } } }, 1500);
    expect(state["c1"]!.entries).toEqual([
      { kind: "tool", tool: { name: "Grep", phase: "call", title: "pairedRunTools", at: 1300 } },
      { kind: "tool", tool: { name: "Grep", phase: "result", isError: true, result: "无匹配", at: 1400 } },
      { kind: "tool", tool: { name: "Edit", phase: "call", title: "a.ts", args: { file_path: "src/a.ts", old_string: "a", new_string: "b" }, at: 1500 } },
    ]);
  });

  it("textSegment 并入紧邻的 text 条目并累计 closedTextLength（工具活动打断即分段）", () => {
    let state: SubagentRunsState = reduceSubagentRuns(initialSubagentRunsState, started, 1000);
    state = reduceSubagentRuns(state, { childId: "c1", parentSessionId: "s1", description: "", status: "running", delta: "先说" }, 1100);
    state = reduceSubagentRuns(state, { childId: "c1", parentSessionId: "s1", description: "", status: "running", delta: "两句" }, 1150);
    // 实况形态：delta 先行，闭合 textSegment 单独成事件（不携带 delta）。
    state = reduceSubagentRuns(state, { childId: "c1", parentSessionId: "s1", description: "", status: "running", textSegment: "先说两句" }, 1200);
    state = reduceSubagentRuns(state, { childId: "c1", parentSessionId: "s1", description: "", status: "running", tool: { name: "Read", phase: "call" } }, 1300);
    state = reduceSubagentRuns(state, { childId: "c1", parentSessionId: "s1", description: "", status: "running", delta: "下一段" }, 1400);
    state = reduceSubagentRuns(state, { childId: "c1", parentSessionId: "s1", description: "", status: "running", textSegment: "下一段" }, 1500);
    // 全部闭合：text.slice(closedTextLength) 即未闭合尾部，应为空。
    expect(state["c1"]).toMatchObject({ text: "先说两句下一段", closedTextLength: 7 });
    expect(state["c1"]!.text.slice(state["c1"]!.closedTextLength!)).toBe("");
    expect(state["c1"]!.entries).toEqual([
      { kind: "text", text: "先说两句" },
      { kind: "tool", tool: { name: "Read", phase: "call", at: 1300 } },
      { kind: "text", text: "下一段" },
    ]);
  });

  it("连续 thinkingDelta 延续同一段；工具活动打断后开新段（与正文分通道）", () => {
    let state: SubagentRunsState = reduceSubagentRuns(initialSubagentRunsState, started, 1000);
    state = reduceSubagentRuns(state, { childId: "c1", parentSessionId: "s1", description: "", status: "running", thinkingDelta: "先看" }, 1100);
    state = reduceSubagentRuns(state, { childId: "c1", parentSessionId: "s1", description: "", status: "running", thinkingDelta: "入口" }, 1200);
    state = reduceSubagentRuns(state, { childId: "c1", parentSessionId: "s1", description: "", status: "running", tool: { name: "Read", phase: "call" } }, 1300);
    state = reduceSubagentRuns(state, { childId: "c1", parentSessionId: "s1", description: "", status: "running", tool: { name: "Read", phase: "result", isError: false } }, 1400);
    state = reduceSubagentRuns(state, { childId: "c1", parentSessionId: "s1", description: "", status: "running", thinkingDelta: "再看" }, 1500);
    state = reduceSubagentRuns(state, { childId: "c1", parentSessionId: "s1", description: "", status: "running", delta: "正文" }, 1600);
    expect(state["c1"]).toMatchObject({ text: "正文" });
    expect(state["c1"]!.entries.map((entry) =>
      entry.kind === "tool" ? `tool:${entry.tool.name}/${entry.tool.phase}` : `${entry.kind}:${entry.text}`,
    )).toEqual([
      "thinking:先看入口",
      "tool:Read/call",
      "tool:Read/result",
      "thinking:再看",
    ]);
  });

  it("thinkingSegment：实况与 thinkingDelta 去重（同段不重复落条），回放直接落成思考条目", () => {
    // 实况：delta 已把同一段推理累积成紧邻思考条目，段落闭合事件不重复落条。
    let live: SubagentRunsState = reduceSubagentRuns(initialSubagentRunsState, started, 1000);
    live = reduceSubagentRuns(live, { childId: "c1", parentSessionId: "s1", description: "", status: "running", thinkingDelta: "先看" }, 1100);
    live = reduceSubagentRuns(live, { childId: "c1", parentSessionId: "s1", description: "", status: "running", thinkingDelta: "入口" }, 1150);
    live = reduceSubagentRuns(live, { childId: "c1", parentSessionId: "s1", description: "", status: "running", thinkingSegment: "先看入口" }, 1200);
    live = reduceSubagentRuns(live, { childId: "c1", parentSessionId: "s1", description: "", status: "running", tool: { name: "Read", phase: "call" } }, 1300);
    expect(live["c1"]!.entries).toEqual([
      { kind: "thinking", text: "先看入口" },
      { kind: "tool", tool: { name: "Read", phase: "call", at: 1300 } },
    ]);
    // 回放（delta 不落盘）：闭合思考段按事件顺序落成条目，不同段各自成条。
    let replayed: SubagentRunsState = reduceSubagentRuns(initialSubagentRunsState, started, 1000);
    replayed = reduceSubagentRuns(replayed, { childId: "c1", parentSessionId: "s1", description: "", status: "running", thinkingSegment: "先看入口" }, 1200);
    replayed = reduceSubagentRuns(replayed, { childId: "c1", parentSessionId: "s1", description: "", status: "running", tool: { name: "Read", phase: "call" } }, 1300);
    replayed = reduceSubagentRuns(replayed, { childId: "c1", parentSessionId: "s1", description: "", status: "running", thinkingSegment: "再看一眼" }, 1400);
    expect(replayed["c1"]!.entries).toEqual([
      { kind: "thinking", text: "先看入口" },
      { kind: "tool", tool: { name: "Read", phase: "call", at: 1300 } },
      { kind: "thinking", text: "再看一眼" },
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

  it("终态档案只被 resumed running 重开：清终态字段、续跑 prompt 入时间线、更新关联调用键", () => {
    let state: SubagentRunsState = reduceSubagentRuns(initialSubagentRunsState, started, 1000);
    state = reduceSubagentRuns(state, { childId: "c1", parentSessionId: "s1", description: "", status: "running", thinkingDelta: "先看" }, 1100);
    state = reduceSubagentRuns(state, { childId: "c1", parentSessionId: "s1", description: "", status: "completed", final: "首段结论" }, 1200);
    const reopened = reduceSubagentRuns(
      state,
      { childId: "c1", parentSessionId: "s1", description: "", status: "running", resumed: true, prompt: "继续查", parentInvocationId: "inv-2" },
      1300,
    );
    expect(reopened["c1"]).toMatchObject({ status: "running", parentInvocationId: "inv-2", text: "" });
    expect(reopened["c1"]!.endedAt).toBeUndefined();
    expect(reopened["c1"]!.final).toBeUndefined();
    expect(reopened["c1"]!.entries).toEqual([
      { kind: "thinking", text: "先看" },
      { kind: "prompt", text: "继续查" },
    ]);
  });

  it("非 resumed 的迟到事件仍忽略；重开后照常累积并可再次终态", () => {
    let state: SubagentRunsState = reduceSubagentRuns(initialSubagentRunsState, started, 1000);
    state = reduceSubagentRuns(state, { childId: "c1", parentSessionId: "s1", description: "", status: "completed", final: "首段结论" }, 1200);
    expect(
      reduceSubagentRuns(state, { childId: "c1", parentSessionId: "s1", description: "", status: "running", delta: "迟到" }, 1250),
    ).toBe(state);
    state = reduceSubagentRuns(state, { childId: "c1", parentSessionId: "s1", description: "", status: "running", resumed: true, prompt: "继续" }, 1300);
    state = reduceSubagentRuns(state, { childId: "c1", parentSessionId: "s1", description: "", status: "running", thinkingDelta: "再想" }, 1400);
    state = reduceSubagentRuns(state, { childId: "c1", parentSessionId: "s1", description: "", status: "completed", final: "第二段结论" }, 1500);
    expect(state["c1"]).toMatchObject({ status: "completed", final: "第二段结论", endedAt: 1500 });
    expect(state["c1"]!.entries).toEqual([
      { kind: "prompt", text: "继续" },
      { kind: "thinking", text: "再想" },
    ]);
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

  it("按 Task 调用 id 反查运行（限定会话，跨会话撞键不误配）", () => {
    expect(runByInvocation(state, "s1", "inv-2")?.childId).toBe("c2");
    // inv-3 属于 s2：在 s1 里查不到，在 s2 里命中；空会话 id 一律不中。
    expect(runByInvocation(state, "s1", "inv-3")).toBeUndefined();
    expect(runByInvocation(state, "s2", "inv-3")?.childId).toBe("c3");
    expect(runByInvocation(state, null, "inv-2")).toBeUndefined();
    expect(runByInvocation(state, "s1", "inv-none")).toBeUndefined();
  });
});

describe("runForTaskRow", () => {
  // c1 有关联键；c2/c3 为同名旧记录（无关联键，final 不同）；c4 唯一标题旧记录；
  // c5 与 c4 同标题但属另一会话（验证会话隔离）。
  const state = [
    { ...started },
    { childId: "c2", parentSessionId: "s1", description: "重名", status: "started" as const },
    { childId: "c2", parentSessionId: "s1", description: "", status: "completed" as const, final: "结论A" },
    { childId: "c3", parentSessionId: "s1", description: "重名", status: "started" as const },
    { childId: "c3", parentSessionId: "s1", description: "", status: "completed" as const, final: "结论B" },
    { childId: "c4", parentSessionId: "s1", description: "唯一旧记录", status: "started" as const },
    { childId: "c4", parentSessionId: "s1", description: "", status: "completed" as const, final: "结论C" },
    { childId: "c5", parentSessionId: "s2", description: "唯一旧记录", status: "started" as const },
  ].reduce<SubagentRunsState>(
    (acc, event, index) => reduceSubagentRuns(acc, event, 1000 + index * 100),
    initialSubagentRunsState,
  );

  it("关联键命中直达", () => {
    expect(runForTaskRow(state, "s1", { invocationId: "inv-1" })?.childId).toBe("c1");
  });

  it("键失配时回退标题唯一匹配；无键旧记录同样命中", () => {
    expect(runForTaskRow(state, "s1", { invocationId: "inv-x", title: "唯一旧记录" })?.childId).toBe("c4");
    expect(runForTaskRow(state, "s1", { title: "唯一旧记录" })?.childId).toBe("c4");
  });

  it("标题匹配限定会话（同标题的他会话运行不干扰）", () => {
    expect(runForTaskRow(state, "s2", { title: "唯一旧记录" })?.childId).toBe("c5");
  });

  it("重名且无结果文本可辨时不猜（返回 undefined 由调用方落归档列表）", () => {
    expect(runForTaskRow(state, "s1", { title: "重名" })).toBeUndefined();
    expect(runForTaskRow(state, "s1", { title: "重名", resultText: "不存在的结论" })).toBeUndefined();
  });

  it("重名时用结果文本（= run.final）消歧", () => {
    expect(runForTaskRow(state, "s1", { title: "重名", resultText: "结论A" })?.childId).toBe("c2");
    expect(runForTaskRow(state, "s1", { title: "重名", resultText: "结论B" })?.childId).toBe("c3");
  });

  it("空标题/空会话/无线索一律不中", () => {
    expect(runForTaskRow(state, "s1", {})).toBeUndefined();
    expect(runForTaskRow(state, "s1", { title: "" })).toBeUndefined();
    expect(runForTaskRow(state, null, { title: "唯一旧记录" })).toBeUndefined();
  });
});

describe("groupRunsByLiveness", () => {
  const run = (childId: string, status: SubagentStatus, startedAt: number): SubagentRun => ({
    childId,
    parentSessionId: "s1",
    description: childId,
    status,
    text: "",
    entries: [],
    startedAt,
  });

  it("存活一组（started/running）、已结束一组（completed/failed/cancelled）", () => {
    const groups = groupRunsByLiveness([
      run("a", "started", 1000),
      run("b", "running", 2000),
      run("c", "completed", 3000),
      run("d", "failed", 4000),
      run("e", "cancelled", 5000),
    ]);
    expect(groups.running.map((item) => item.childId)).toEqual(["b", "a"]);
    expect(groups.completed.map((item) => item.childId)).toEqual(["e", "d", "c"]);
  });

  it("两组各自按创建时间倒序（新→旧），不改动入参数组顺序", () => {
    const input = [
      run("old_run", "running", 1000),
      run("new_done", "completed", 9000),
      run("new_run", "running", 8000),
      run("old_done", "failed", 2000),
    ];
    const groups = groupRunsByLiveness(input);
    expect(groups.running.map((item) => item.childId)).toEqual(["new_run", "old_run"]);
    expect(groups.completed.map((item) => item.childId)).toEqual(["new_done", "old_done"]);
    expect(input.map((item) => item.childId)).toEqual(["old_run", "new_done", "new_run", "old_done"]);
  });

  it("空入参给空两组", () => {
    expect(groupRunsByLiveness([])).toEqual({ running: [], completed: [] });
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

  it("call 的摘要与 args 投影保留在行上；result 的摘录并回同一行", () => {
    const rows = pairedRunTools([
      { name: "Grep", phase: "call", title: "pairedRunTools", at: 1 },
      { name: "Grep", phase: "result", isError: true, result: "无匹配", at: 2 },
      { name: "Edit", phase: "call", title: "a.ts", args: { file_path: "src/a.ts", new_string: "b" }, at: 3 },
      { name: "Edit", phase: "result", isError: false, at: 4 },
    ]);
    expect(rows).toEqual([
      { name: "Grep", done: true, isError: true, title: "pairedRunTools", result: "无匹配", at: 1 },
      { name: "Edit", done: true, isError: false, title: "a.ts", args: { file_path: "src/a.ts", new_string: "b" }, at: 3 },
    ]);
  });

  it("迟到 result（无未决 call）单独立行", () => {
    const rows = pairedRunTools([{ name: "Read", phase: "result", isError: false, result: "内容", at: 9 }]);
    expect(rows).toEqual([{ name: "Read", done: true, result: "内容", at: 9 }]);
  });
});

describe("runConversationChunks", () => {
  it("思考段与连续工具条目组成的工具组按事件顺序交替", () => {
    const chunks = runConversationChunks([
      { kind: "thinking", text: "先看入口" },
      { kind: "tool", tool: { name: "Read", phase: "call", at: 1 } },
      { kind: "tool", tool: { name: "Read", phase: "result", isError: false, at: 2 } },
      { kind: "thinking", text: "再查调用方" },
      { kind: "tool", tool: { name: "Grep", phase: "call", title: "chunk", at: 3 } },
    ]);
    expect(chunks).toEqual([
      { kind: "thinking", text: "先看入口" },
      { kind: "tools", tools: [
        { name: "Read", phase: "call", at: 1 },
        { name: "Read", phase: "result", isError: false, at: 2 },
      ] },
      { kind: "thinking", text: "再查调用方" },
      { kind: "tools", tools: [{ name: "Grep", phase: "call", title: "chunk", at: 3 }] },
    ]);
  });

  it("连续思考段不被合并（各自独立幽灵行）；空时间线给空分段", () => {
    expect(runConversationChunks([
      { kind: "thinking", text: "段一" },
      { kind: "thinking", text: "段二" },
    ])).toEqual([
      { kind: "thinking", text: "段一" },
      { kind: "thinking", text: "段二" },
    ]);
    expect(runConversationChunks([])).toEqual([]);
  });

  it("续跑 prompt 独立成分段（打断工具合组）", () => {
    expect(runConversationChunks([
      { kind: "tool", tool: { name: "Read", phase: "call", at: 1 } },
      { kind: "prompt", text: "继续" },
      { kind: "tool", tool: { name: "Read", phase: "result", isError: false, at: 2 } },
    ])).toEqual([
      { kind: "tools", tools: [{ name: "Read", phase: "call", at: 1 }] },
      { kind: "prompt", text: "继续" },
      { kind: "tools", tools: [{ name: "Read", phase: "result", isError: false, at: 2 }] },
    ]);
  });

  it("正文段与工具组按事件顺序穿插；相邻 text 条目合并成一块", () => {
    const chunks = runConversationChunks([
      { kind: "text", text: "先说两句" },
      { kind: "tool", tool: { name: "Edit", phase: "call", title: "a.ts", at: 1 } },
      { kind: "tool", tool: { name: "Edit", phase: "result", isError: false, at: 2 } },
      { kind: "text", text: "中段" },
      { kind: "text", text: "续写" },
      { kind: "tool", tool: { name: "Read", phase: "call", at: 3 } },
    ]);
    expect(chunks).toEqual([
      { kind: "text", text: "先说两句" },
      { kind: "tools", tools: [
        { name: "Edit", phase: "call", title: "a.ts", at: 1 },
        { name: "Edit", phase: "result", isError: false, at: 2 },
      ] },
      { kind: "text", text: "中段续写" },
      { kind: "tools", tools: [{ name: "Read", phase: "call", at: 3 }] },
    ]);
  });
});

describe("formatRunDuration", () => {
  it("mm:ss 格式", () => {
    expect(formatRunDuration(1000, 1000)).toBe("0:00");
    expect(formatRunDuration(1000, 66_200)).toBe("1:05");
  });
});
