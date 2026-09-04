// askUserPort 桥测试：一轮提问的挂起/应答/取消/超时语义（权限桥同款路径）
// + 卡片生命周期不变量：会话内串行（一次一卡）、非渲染层落定广播
// chat:question-settled、挂起事件留存供切会话回放。不起 Electron：
// send/notify/messageId 全部注入假件，注册表直接操纵。
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChatQuestionEvent, ChatQuestionResponse } from "../shared/ipc";
import type { AskUserItem, AskUserOutcome, AskUserPort } from "@innocenceharness/plugin-ask";
import {
  cancelPendingQuestions,
  createAskUserPort,
  pendingQuestionEvents,
  rejectPendingQuestions,
  type AskUserPortDeps,
  type AskUserQueueRegistry,
  type PendingQuestionRegistry,
} from "./askUserPort";
import { QUESTION_AUTO_CONTINUE_TIMEOUT_MS } from "./runtimeHooks";

afterEach(() => {
  vi.useRealTimers();
});

const questions: AskUserItem[] = [
  {
    question: "Which database?",
    header: "Database",
    options: [{ label: "PostgreSQL" }, { label: "SQLite", description: "embedded" }],
  },
];

/** 串行化经尾链挂起一轮（即便无前驱也是一个微任务）：冲刷后再断言。 */
async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

interface BridgeHarness {
  registry: PendingQuestionRegistry;
  queues: AskUserQueueRegistry;
  events: ChatQuestionEvent[];
  settled: string[];
  notify: ReturnType<typeof vi.fn>;
  result: Promise<AskUserOutcome>;
  respond(requestId: string, response: ChatQuestionResponse): void;
}

function makeDeps(
  overrides: Omit<Partial<AskUserPortDeps>, "notify"> = {},
): AskUserPortDeps & {
  registry: PendingQuestionRegistry;
  queues: AskUserQueueRegistry;
  events: ChatQuestionEvent[];
  settled: string[];
  notify: ReturnType<typeof vi.fn>;
} {
  const registry: PendingQuestionRegistry = new Map();
  const queues: AskUserQueueRegistry = new Map();
  const events: ChatQuestionEvent[] = [];
  const settled: string[] = [];
  const notify = vi.fn();
  return {
    registry,
    queues,
    events,
    settled,
    notify,
    pendingQuestions: registry,
    askQueues: queues,
    send: (event) => events.push(event),
    sendSettled: (requestId) => settled.push(requestId),
    resolveMessageId: () => "m1",
    questionAutoContinue: () => false,
    ...overrides,
  };
}

function makeBridge(overrides: Partial<AskUserPortDeps> = {}): BridgeHarness {
  const deps = makeDeps(overrides);
  const port = createAskUserPort(deps, { sessionId: "s1", routeId: "main" });
  return {
    ...deps,
    result: port(questions),
    respond: (requestId, response) => {
      const pending = deps.registry.get(requestId);
      expect(pending).toBeDefined();
      pending!.finish(response);
    },
  };
}

describe("createAskUserPort", () => {
  it("一轮提问推送一张事件卡并挂起注册表；作答直达 answers 并广播落定", async () => {
    const harness = makeBridge();
    await flush();
    expect(harness.events).toHaveLength(1);
    const event = harness.events[0]!;
    expect(event).toMatchObject({
      sessionId: "s1",
      messageId: "m1",
      toolName: "ask_user",
    });
    expect(event.questions[0]).toMatchObject({ question: "Which database?", header: "Database" });
    expect(event.questions[0]!.options).toEqual([
      { label: "PostgreSQL" },
      { label: "SQLite", description: "embedded" },
    ]);
    expect(harness.notify).toHaveBeenCalledWith("s1");
    expect(harness.registry.size).toBe(1);
    harness.respond(event.requestId, {
      answers: [{ question: "Which database?", answers: ["PostgreSQL"] }],
    });
    await expect(harness.result).resolves.toEqual({
      status: "answered",
      answers: [{ question: "Which database?", answers: ["PostgreSQL"] }],
    });
    // 落定广播 + 注册表清空（迟到应答对已了结请求无效）。
    expect(harness.settled).toEqual([event.requestId]);
    expect(harness.registry.size).toBe(0);
  });

  it("null 应答折叠为 skipped（用户跳过）", async () => {
    const harness = makeBridge();
    await flush();
    harness.respond(harness.events[0]!.requestId, null);
    await expect(harness.result).resolves.toEqual({ status: "skipped" });
    expect(harness.settled).toHaveLength(1);
  });

  it("会话内串行：第二张卡只在前一张落定后推送（一次一卡）", async () => {
    const deps = makeDeps();
    const port: AskUserPort = createAskUserPort(deps, { sessionId: "s1", routeId: "main" });
    const first = port(questions);
    const second = port(questions);
    await flush();
    // 首卡已推、次卡未推；注册表里只有首卡。
    expect(deps.events).toHaveLength(1);
    expect(deps.registry.size).toBe(1);
    deps.registry.get(deps.events[0]!.requestId)!.finish(null);
    await expect(first).resolves.toEqual({ status: "skipped" });
    await flush();
    // 首卡落定后次卡才浮出。
    expect(deps.events).toHaveLength(2);
    deps.registry.get(deps.events[1]!.requestId)!.finish({
      answers: [{ question: "Which database?", answers: ["SQLite"] }],
    });
    await expect(second).resolves.toEqual({
      status: "answered",
      answers: [{ question: "Which database?", answers: ["SQLite"] }],
    });
    // 两轮各自广播一次落定；尾链清空。
    expect(deps.settled).toEqual([deps.events[0]!.requestId, deps.events[1]!.requestId]);
    expect(deps.queues.size).toBe(0);
  });

  it("跨会话互不排队：两会话的卡同时浮出", async () => {
    const deps = makeDeps();
    const portA = createAskUserPort(deps, { sessionId: "a", routeId: "main" });
    const portB = createAskUserPort(deps, { sessionId: "b", routeId: "main" });
    const pendingA = portA(questions);
    const pendingB = portB(questions);
    await flush();
    expect(deps.events).toHaveLength(2);
    expect(deps.registry.size).toBe(2);
    deps.registry.get(deps.events[0]!.requestId)!.finish(null);
    deps.registry.get(deps.events[1]!.requestId)!.finish(null);
    await expect(pendingA).resolves.toEqual({ status: "skipped" });
    await expect(pendingB).resolves.toEqual({ status: "skipped" });
  });

  it("stop/dispose 取消：该会话挂起问题落定为跳过，他会有不受影响", async () => {
    const deps = makeDeps();
    const portA = createAskUserPort(deps, { sessionId: "a", routeId: "main" });
    const portB = createAskUserPort(deps, { sessionId: "b", routeId: "main" });
    const pendingA = portA(questions);
    const pendingB = portB(questions);
    await flush();
    expect(deps.events).toHaveLength(2);
    expect(deps.registry.size).toBe(2);
    cancelPendingQuestions(deps.registry, "a");
    await expect(pendingA).resolves.toEqual({ status: "skipped" });
    // b 仍挂起；再作答后正常落定。
    const eventB = deps.events.find((event) => event.sessionId === "b")!;
    deps.registry.get(eventB.requestId)!.finish({
      answers: [{ question: "Which database?", answers: ["SQLite"] }],
    });
    await expect(pendingB).resolves.toEqual({
      status: "answered",
      answers: [{ question: "Which database?", answers: ["SQLite"] }],
    });
  });

  it("questionAutoContinue 开启：5 分钟未答自动跳过并广播落定", async () => {
    vi.useFakeTimers();
    const harness = makeBridge({ questionAutoContinue: () => true });
    await flush();
    vi.advanceTimersByTime(QUESTION_AUTO_CONTINUE_TIMEOUT_MS - 1);
    // 到期前一刻仍挂起。
    expect(harness.registry.size).toBe(1);
    expect(harness.settled).toHaveLength(0);
    vi.advanceTimersByTime(1);
    await expect(harness.result).resolves.toEqual({ status: "skipped" });
    expect(harness.registry.size).toBe(0);
    expect(harness.settled).toEqual([harness.events[0]!.requestId]);
  });

  it("questionAutoContinue 关闭：不设定时器，一直等待", async () => {
    vi.useFakeTimers();
    const harness = makeBridge({ questionAutoContinue: () => false });
    await flush();
    vi.advanceTimersByTime(QUESTION_AUTO_CONTINUE_TIMEOUT_MS * 4);
    expect(harness.registry.size).toBe(1);
    harness.respond(harness.events[0]!.requestId, null);
    await expect(harness.result).resolves.toEqual({ status: "skipped" });
  });

  it("关机拒绝：全部挂起问题落定跳过且注册表清空", async () => {
    const harness = makeBridge();
    await flush();
    rejectPendingQuestions(harness.registry);
    await expect(harness.result).resolves.toEqual({ status: "skipped" });
    expect(harness.registry.size).toBe(0);
  });

  it("切会话回放：pendingQuestionEvents 返回该会话挂起卡的事件载荷", async () => {
    const harness = makeBridge();
    await flush();
    expect(pendingQuestionEvents(harness.registry, "s1")).toEqual([harness.events[0]]);
    expect(pendingQuestionEvents(harness.registry, "other")).toEqual([]);
    harness.respond(harness.events[0]!.requestId, null);
    await harness.result;
    expect(pendingQuestionEvents(harness.registry, "s1")).toEqual([]);
  });
});
