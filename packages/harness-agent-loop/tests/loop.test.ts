import { describe, expect, it, vi } from "vitest";
import { convertArrayToReadableStream, MockLanguageModelV3 } from "ai/test";
import { createRunLoop } from "../src";
import { PermissionEngine } from "@innocenceharness/harness-permissions";
import { Context } from "@innocenceharness/kernel";
import { ToolsPlugin } from "@innocenceharness/harness-tools";
import { ContextManager, textMessage, type Message } from "@innocenceharness/harness-session";
import type { Delta, Provider, ProviderModel } from "@innocenceharness/harness-providers";
import type { Tool, ToolResult } from "@innocenceharness/harness-tools";
import type { HarnessEvent } from "@innocenceharness/harness-session";

type MockStreamPart = Awaited<ReturnType<MockLanguageModelV3["doStream"]>>["stream"] extends ReadableStream<infer Part>
  ? Part
  : never;

type SdkTurn = MockStreamPart[];

function sdkProviderForTurns(turns: readonly SdkTurn[]): {
  provider: Provider & { model: ProviderModel };
  model: MockLanguageModelV3;
} {
  let cursor = 0;
  const model = new MockLanguageModelV3({
    provider: "sdk-test",
    modelId: "sdk-model",
    async doStream() {
      const turn = turns[Math.min(cursor, turns.length - 1)] ?? [];
      cursor += 1;
      return { stream: convertArrayToReadableStream(turn) };
    },
  });
  return {
    provider: sdkModelProvider(
      { value: model, providerId: "sdk-test", modelId: "sdk-model" },
      () => {
        throw new Error("legacy chat must not run");
      },
    ),
    model,
  };
}

function sdkToolCall(id: string, toolName: string, args: Record<string, unknown>): MockStreamPart {
  return { type: "tool-call", toolCallId: id, toolName, input: JSON.stringify(args) };
}

function sdkText(text: string): MockStreamPart[] {
  return [
    { type: "stream-start", warnings: [] },
    { type: "text-start", id: "text-1" },
    { type: "text-delta", id: "text-1", delta: text },
  ];
}

function sdkFinish(reason: "stop" | "tool-calls" = "stop"): MockStreamPart {
  return {
    type: "finish",
    usage: {
      inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
      outputTokens: { total: 1, text: 1, reasoning: 0 },
    },
    finishReason: { unified: reason, raw: reason },
  };
}

interface Turn {
  text?: string;
  toolCalls?: Array<{ toolName: string; args?: Record<string, unknown> }>;
}

function scriptedProvider(turns: Turn[], log?: (i: number) => void): Provider {
  let i = 0;
  return {
    id: "scripted",
    async *chat(): AsyncIterable<Delta> {
      log?.(i);
      const turn = turns[Math.min(i, turns.length - 1)];
      i += 1;
      if (turn.text) yield { type: "text", text: turn.text };
      for (const [n, call] of (turn.toolCalls ?? []).entries()) {
        yield {
          type: "toolCall",
          id: `call_${i}_${n}`,
          toolName: call.toolName,
          args: call.args ?? {},
        };
      }
    },
  };
}

function sdkModelProvider(model: ProviderModel, onLegacyChat: () => void): Provider & { model: ProviderModel } {
  return {
    id: model.providerId,
    model,
    async *chat(): AsyncIterable<Delta> {
      onLegacyChat();
      throw new Error("legacy provider path must not run when a model is available");
    },
  };
}

function fakeTool(
  name: string,
  behavior: (args: Record<string, unknown>) => Promise<ToolResult>,
  readOnly = false,
): Tool & { calls: Array<Record<string, unknown>> } {
  const t = {
    name,
    description: name,
    readOnly,
    sideEffect: readOnly ? ("none" as const) : ("unknown" as const),
    parameters: { type: "object" },
    calls: [] as Array<Record<string, unknown>>,
    permissionResource: () => ({
      action: readOnly ? "read" : "write",
      kind: "test",
      scope: name,
    }),
    persistArgs: (args: Record<string, unknown>) => ({ ...args }),
    async execute(args: Record<string, unknown>): Promise<ToolResult> {
      t.calls.push(args);
      return behavior(args);
    },
  } as Tool & { calls: Array<Record<string, unknown>> };
  return t;
}

const allowAll = () =>
  new PermissionEngine({ mode: "auto", decider: { ask: async () => "deny" } });

async function setup(
  tools: Tool[],
  provider: Provider,
  permission = allowAll(),
  observeEvent?: (event: HarnessEvent) => void,
) {
  const kernel = new Context();
  await kernel.plugin(ToolsPlugin);
  for (const tool of tools) kernel.tools.register(tool);
  const events: HarnessEvent[] = [];
  const history: Message[] = [];
  const loop = createRunLoop({
    tools: kernel.tools,
    provider,
    permission,
    history,
    systemPrompt: "test",
    workspaceRoot: "/tmp/ws",
    onEvent: (event) => {
      events.push(event);
      observeEvent?.(event);
    },
  });
  return {
    toolsService: kernel.tools,
    events,
    history,
    run: (
      text: string,
      extra: {
        maxTurns?: number;
        signal?: AbortSignal;
        toolTimeoutMs?: number;
        abortGraceMs?: number;
      } = {},
    ) => loop(textMessage("user", text), extra),
  };
}

/** Tool whose body rejects with the derived signal's abort reason. */
function abortAwareTool(name: string): Tool & { calls: number } {
  const t = {
    name,
    description: name,
    readOnly: false,
    sideEffect: "unknown" as const,
    parameters: { type: "object" },
    calls: 0,
    permissionResource: () => ({ action: "write", kind: "test", scope: name }),
    persistArgs: (args: Record<string, unknown>) => ({ ...args }),
    execute(_args: Record<string, unknown>, ctx: { signal: AbortSignal }) {
      t.calls += 1;
      return new Promise<ToolResult>((_resolve, reject) => {
        ctx.signal.addEventListener("abort", () => reject(ctx.signal.reason), { once: true });
      });
    },
  } as unknown as Tool & { calls: number };
  return t;
}

describe("runLoop", () => {
  it("runs tool calls then finishes with the final text", async () => {
    const echo = fakeTool("Echo", async (args) => ({
      content: `echo:${String(args.msg ?? "")}`,
    }));
    const provider = scriptedProvider([
      { toolCalls: [{ toolName: "Echo", args: { msg: "hi" } }] },
      { text: "all done" },
    ]);
    const { events, history, run } = await setup([echo], provider);

    const result = await run("please echo");
    expect(result.turns).toBe(2);
    expect(result.finalText).toBe("all done");
    expect(echo.calls).toEqual([{ msg: "hi" }]);

    // History: user, assistant(toolCall), user(toolResult), assistant(final)
    expect(history.map((m) => m.role)).toEqual(["user", "assistant", "user", "assistant"]);
    const toolResult = history[2].parts[0];
    expect(toolResult).toMatchObject({
      type: "toolResult",
      content: "echo:hi",
      isError: undefined,
    });

    const types = events.map((e) => e.type);
    expect(types).toContain("turnStart");
    expect(types).toContain("token");
    expect(types.filter((t) => t === "toolCall")).toHaveLength(1);
    expect(types.filter((t) => t === "toolResult")).toHaveLength(1);
    expect(types[types.length - 1]).toBe("done");
  });

  it("keeps the Harness permission order when an SDK model emits a tool call", async () => {
    const order: string[] = [];
    let directSdkExecuteCount = 0;
    let harnessExecuteCount = 0;
    let step = 0;
    const model = new MockLanguageModelV3({
      provider: "sdk-test",
      modelId: "sdk-model",
      async doStream(options) {
        directSdkExecuteCount += (options.tools ?? []).filter(
          (tool) => "execute" in tool && typeof (tool as { execute?: unknown }).execute === "function",
        ).length;
        step += 1;
        const streamEvents: MockStreamPart[] = step === 1
          ? [
              { type: "stream-start", warnings: [] },
              { type: "tool-input-start", id: "sdk-call", toolName: "Controlled" },
              { type: "tool-input-delta", id: "sdk-call", delta: '{"secret":"SDK-SECRET"}' },
              { type: "tool-input-end", id: "sdk-call" },
              {
                type: "tool-call",
                toolCallId: "sdk-call",
                toolName: "Controlled",
                input: '{"secret":"SDK-SECRET"}',
              },
              {
                type: "finish",
                usage: {
                  inputTokens: { total: 3, noCache: 3, cacheRead: 0, cacheWrite: 0 },
                  outputTokens: { total: 1, text: 1, reasoning: 0 },
                },
                finishReason: { unified: "tool-calls", raw: "sdk-wire-finish-secret" },
              },
            ]
          : [
              { type: "stream-start", warnings: [] },
              { type: "text-start", id: "text-1" },
              { type: "text-delta", id: "text-1", delta: "finished" },
              {
                type: "finish",
                usage: {
                  inputTokens: { total: 4, noCache: 4, cacheRead: 0, cacheWrite: 0 },
                  outputTokens: { total: 2, text: 2, reasoning: 0 },
                },
                finishReason: { unified: "stop", raw: "stop" },
              },
            ];
        return {
          stream: convertArrayToReadableStream(streamEvents),
        };
      },
    });
    const provider = sdkModelProvider(
      { value: model, providerId: "sdk-test", modelId: "sdk-model" },
      () => {
        throw new Error("legacy chat must not run");
      },
    );
    const controlled: Tool = {
      name: "Controlled",
      description: "Controlled",
      readOnly: false,
      sideEffect: "unknown",
      parameters: { type: "object" },
      async validateArgs(args) {
        order.push("validateArgs");
        expect(args).toEqual({ secret: "SDK-SECRET" });
      },
      permissionResource(args) {
        order.push("permissionResource");
        expect(args).toEqual({ secret: "SDK-SECRET" });
        return { action: "write", kind: "test", scope: "controlled" };
      },
      persistArgs(args) {
        order.push("persistArgs");
        expect(args).toEqual({ secret: "SDK-SECRET" });
        return { secretPresent: typeof args.secret === "string" };
      },
      async execute(args) {
        order.push("execute");
        harnessExecuteCount += 1;
        expect(args).toEqual({ secret: "SDK-SECRET" });
        return { content: "controlled" };
      },
    };
    const permission = new PermissionEngine({
      mode: "ask",
      decider: {
        ask: async () => {
          order.push("permission");
          return "allow";
        },
      },
    });
    const { events, history, run } = await setup(
      [controlled],
      provider,
      permission,
      (event) => {
        if (event.type === "assistantMessage") order.push("redactedAssistant");
        if (event.type === "toolCall") order.push("audit");
        if (event.type === "toolResult") order.push("toolResult");
      },
    );

    const result = await run("run the controlled tool");

    expect(order.slice(0, 8)).toEqual([
      "validateArgs",
      "permissionResource",
      "persistArgs",
      "redactedAssistant",
      "audit",
      "permission",
      "execute",
      "toolResult",
    ]);
    expect(directSdkExecuteCount).toBe(0);
    expect(harnessExecuteCount).toBe(1);
    expect(model.doStreamCalls).toHaveLength(2);
    expect(events.map((event) => event.type)).toEqual([
      "turnStart",
      "assistantMessage",
      "toolCall",
      "permission",
      "toolResult",
      "turnStart",
      "token",
      "assistantMessage",
      "done",
    ]);
    expect(JSON.stringify([history, events])).not.toContain("SDK-SECRET");
    expect(JSON.stringify(result)).not.toContain("sdk-wire-finish-secret");
    expect(JSON.stringify(result)).not.toContain("rawFinishReason");
    expect(result).toMatchObject({
      finalText: "finished",
      finishReason: "stop",
      usage: { inputTokens: 7, outputTokens: 3, totalTokens: 10 },
      stepMetadata: [
        { providerId: "sdk-test", modelId: "sdk-model", finishReason: "tool-calls" },
        { providerId: "sdk-test", modelId: "sdk-model", finishReason: "stop" },
      ],
    });
  });

  it("uses a controlled SDK step for compaction instead of legacy chat", async () => {
    const { provider, model } = sdkProviderForTurns([
      [...sdkText("summary"), sdkFinish()],
      [...sdkText("final"), sdkFinish()],
    ]);
    const history: Message[] = [
      textMessage("user", "first"),
      { role: "assistant", parts: [{ type: "text", text: "first answer" }] },
      textMessage("user", "second"),
      { role: "assistant", parts: [{ type: "text", text: "second answer" }] },
      textMessage("user", "third"),
      { role: "assistant", parts: [{ type: "text", text: "third answer" }] },
    ];
    const kernel = new Context();
    await kernel.plugin(ToolsPlugin);
    const loop = createRunLoop({
      tools: kernel.tools,
      provider,
      permission: allowAll(),
      history,
      systemPrompt: "test",
      workspaceRoot: "/tmp/ws",
      compactor: new ContextManager({ maxContextTokens: 1, keepRecent: 2 }),
      onEvent: () => {},
    });

    const result = await loop(textMessage("user", "latest"));

    expect(result.finalText).toBe("final");
    expect(model.doStreamCalls).toHaveLength(2);
  });

  it("normalizes SDK model errors before they reach Harness events", async () => {
    const sensitive = "credential=SDK-ERROR-SECRET prompt=private toolArgs=private";
    const { provider } = sdkProviderForTurns([[
      { type: "stream-start", warnings: [] },
      { type: "error", error: new Error(sensitive) },
      {
        type: "finish",
        usage: {
          inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
          outputTokens: { total: 0, text: 0, reasoning: 0 },
        },
        finishReason: { unified: "error", raw: "upstream-secret" },
      },
    ]]);
    const { events, history, run } = await setup([], provider);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      const result = await run("sensitive request");

      expect(events).toContainEqual({ type: "error", message: "Model request failed", fatal: true });
      expect(JSON.stringify([events, history])).not.toContain(sensitive);
      expect(result).toMatchObject({
        finalText: "",
        finishReason: "error",
        stepMetadata: [{ finishReason: "error" }],
      });
    } finally {
      consoleError.mockRestore();
    }
  });

  it("classifies legacy provider failures into actionable messages (HTTP 403)", async () => {
    const upstream = "无权访问 max 分组（服务商原始响应，绝不外泄）";
    const provider: Provider = {
      id: "legacy-fail",
      async *chat(): AsyncIterable<Delta> {
        throw Object.assign(new Error(upstream), { statusCode: 403 });
      },
    };
    const { events, run } = await setup([], provider);
    await run("x");
    const errorEvent = events.find((e) => e.type === "error");
    expect(errorEvent && errorEvent.type === "error" && errorEvent.message).toContain("HTTP 403");
    expect(errorEvent && errorEvent.type === "error" && errorEvent.message).toContain("拒绝访问");
    expect(JSON.stringify(events)).not.toContain("max 分组");
  });

  it("rejects denied SDK MCP calls without leaking raw arguments", async () => {
    const secret = "SDK-MCP-SECRET";
    const { provider } = sdkProviderForTurns([
      [
        { type: "stream-start", warnings: [] },
        sdkToolCall("mcp-call", "mcp__ci__deploy", { apiKey: secret }),
        sdkFinish("tool-calls"),
      ],
      [...sdkText("denied"), sdkFinish()],
    ]);
    let executions = 0;
    const mcp: Tool = {
      name: "mcp__ci__deploy",
      description: "deploy",
      readOnly: false,
      sideEffect: "unknown",
      parameters: { type: "object" },
      permissionResource: () => ({ action: "call", kind: "mcp", scope: "ci/deploy" }),
      persistArgs: (args) => ({ params: Object.keys(args) }),
      async execute() {
        executions += 1;
        return { content: "unexpected" };
      },
    };
    const permission = new PermissionEngine({
      mode: "plan",
      decider: { ask: async () => "allow" },
    });
    const { events, history, run } = await setup([mcp], provider, permission);

    const result = await run("deploy");

    expect(result.finalText).toBe("denied");
    expect(executions).toBe(0);
    expect(history[2]?.parts[0]).toMatchObject({ isError: true, content: expect.stringContaining("权限被拒绝") });
    expect(JSON.stringify([history, events])).not.toContain(secret);
  });

  it("keeps SDK tool timeouts within the Harness executor", async () => {
    const hang = abortAwareTool("Hang");
    const { provider, model } = sdkProviderForTurns([
      [
        { type: "stream-start", warnings: [] },
        sdkToolCall("hang-call", "Hang", {}),
        sdkFinish("tool-calls"),
      ],
      [...sdkText("recovered"), sdkFinish()],
    ]);
    const { events, history, run } = await setup([hang], provider);

    const result = await run("run", { toolTimeoutMs: 20, abortGraceMs: 20 });

    expect(result.finalText).toBe("recovered");
    expect(model.doStreamCalls).toHaveLength(2);
    expect(history[2]?.parts[0]).toMatchObject({ isError: true, content: expect.stringContaining("超时") });
    const toolResult = events.find((event) => event.type === "toolResult");
    expect(toolResult && toolResult.type === "toolResult" && toolResult.outcome).toBe("timeout");
  });

  it("enforces outer max turns for SDK steps (plus one tools-free wrap-up)", async () => {
    const loop = fakeTool("Loop", async () => ({ content: "again" }));
    const { provider, model } = sdkProviderForTurns([
      [
        { type: "stream-start", warnings: [] },
        sdkToolCall("loop-1", "Loop", {}),
        sdkFinish("tool-calls"),
      ],
      [
        { type: "stream-start", warnings: [] },
        sdkToolCall("loop-2", "Loop", {}),
        sdkFinish("tool-calls"),
      ],
      [...sdkText("wrap-up"), sdkFinish()],
    ]);
    const { run } = await setup([loop], provider);

    const result = await run("loop", { maxTurns: 2 });

    expect(result.turns).toBe(2);
    expect(loop.calls).toHaveLength(2);
    // 轮次封顶后恰好一次收尾步（无工具定义）：第 3 次模型调用逼出文本结论。
    expect(model.doStreamCalls).toHaveLength(3);
    expect(result.finalText).toBe("wrap-up");
  });

  it("does not ask permission for remaining SDK calls after a stop", async () => {
    const stop = new AbortController();
    let asks = 0;
    const permission = new PermissionEngine({
      mode: "ask",
      decider: {
        ask: async () => {
          asks += 1;
          return "allow";
        },
      },
    });
    const first: Tool = {
      name: "Stop",
      description: "Stop",
      readOnly: false,
      sideEffect: "unknown",
      parameters: { type: "object" },
      permissionResource: () => ({ action: "write", kind: "test", scope: "stop" }),
      persistArgs: (args) => ({ ...args }),
      execute: (_args, ctx) =>
        new Promise<ToolResult>((_resolve, reject) => {
          ctx.signal.addEventListener("abort", () => reject(ctx.signal.reason), { once: true });
          queueMicrotask(() => stop.abort());
        }),
    };
    const followUp = fakeTool("FollowUp", async () => ({ content: "unexpected" }));
    const { provider } = sdkProviderForTurns([[
      { type: "stream-start", warnings: [] },
      sdkToolCall("stop-call", "Stop", {}),
      sdkToolCall("follow-call", "FollowUp", {}),
      sdkFinish("tool-calls"),
    ]]);
    const { history, run } = await setup([first, followUp], provider, permission);

    const result = await run("stop", { signal: stop.signal });

    expect(result.aborted).toBe(true);
    expect(asks).toBe(1);
    expect(followUp.calls).toHaveLength(0);
    expect(history[2]?.parts[1]).toMatchObject({ isError: true, content: expect.stringContaining("运行已中止") });
  });

  it("unknown tools produce an error result, not a crash", async () => {
    const provider = scriptedProvider([
      { toolCalls: [{ toolName: "Ghost" }] },
      { text: "recovered" },
    ]);
    const { history, run } = await setup([], provider);
    const result = await run("x");
    expect(result.finalText).toBe("recovered");
    const tr = history[2].parts[0] as { isError?: boolean; content: string };
    expect(tr.isError).toBe(true);
    expect(tr.content).toContain("未知工具");
  });

  it("thrown tool errors feed back to the model as error results", async () => {
    const bomb = fakeTool("Bomb", async () => {
      throw new Error("boom");
    });
    const provider = scriptedProvider([
      { toolCalls: [{ toolName: "Bomb" }] },
      { text: "handled" },
    ]);
    const { events, history, run } = await setup([bomb], provider);
    const result = await run("x");
    expect(result.finalText).toBe("handled");
    const tr = history[2].parts[0] as { isError?: boolean; content: string };
    expect(tr.isError).toBe(true);
    expect(tr.content).toContain("工具执行出错");
    expect(events.filter((e) => e.type === "error")).toHaveLength(0);
  });

  it("permission deny turns into an error tool result", async () => {
    const write = fakeTool("Write", async () => ({ content: "written" }));
    const provider = scriptedProvider([
      { toolCalls: [{ toolName: "Write", args: { path: "a.ts" } }] },
      { text: "okay, I will not" },
    ]);
    const permission = new PermissionEngine({
      mode: "plan",
      decider: { ask: async () => "allow" },
    });
    const { history, run, events } = await setup([write], provider, permission);
    const result = await run("write it");
    expect(result.finalText).toBe("okay, I will not");
    expect(write.calls).toHaveLength(0);
    const tr = history[2].parts[0] as { isError?: boolean; content: string };
    expect(tr.isError).toBe(true);
    expect(tr.content).toContain("权限被拒绝");
    const permEvent = events.find((e) => e.type === "permission");
    expect(permEvent && permEvent.type === "permission" && permEvent.resolution.via).toBe(
      "planMode",
    );
  });

  it("stops after maxTurns even if the model keeps calling tools", async () => {
    const loop = fakeTool("Loop", async () => ({ content: "again" }));
    const provider = scriptedProvider([{ toolCalls: [{ toolName: "Loop" }] }]);
    const { run } = await setup([loop], provider);
    const result = await run("go", { maxTurns: 3 });
    expect(result.turns).toBe(3);
    expect(loop.calls).toHaveLength(3);
  });

  it("maxTurns exhaustion forces a tools-free wrap-up step (no silent no-conclusion)", async () => {
    const loop = fakeTool("Loop", async () => ({ content: "again" }));
    const provider = scriptedProvider([
      { toolCalls: [{ toolName: "Loop" }] },
      { toolCalls: [{ toolName: "Loop" }] },
      { text: "最终结论" },
    ]);
    const { history, run } = await setup([loop], provider);
    const result = await run("go", { maxTurns: 2 });
    // 轮次封顶：工具只执行了两轮，收尾步不计数。
    expect(result.turns).toBe(2);
    expect(loop.calls).toHaveLength(2);
    // 收尾步逼出文本结论，落在工具结果轮之后。
    expect(result.finalText).toBe("最终结论");
    const tail = history[history.length - 1];
    expect(tail?.role).toBe("assistant");
    expect(tail?.parts[0]).toMatchObject({ type: "text", text: "最终结论" });
  });

  it("no wrap-up step when the run already ended with a text answer", async () => {
    let chatCalls = 0;
    const provider = scriptedProvider([{ text: "答案" }], () => {
      chatCalls += 1;
    });
    const { run } = await setup([], provider);
    const result = await run("go", { maxTurns: 2 });
    expect(result.finalText).toBe("答案");
    expect(result.turns).toBe(1);
    // 文本结论轮后未再请求模型（无收尾步）。
    expect(chatCalls).toBe(1);
  });

  it("multiple tool calls in one turn each get a result", async () => {
    const a = fakeTool("A", async () => ({ content: "a" }));
    const b = fakeTool("B", async () => ({ content: "b" }));
    const provider = scriptedProvider([
      { toolCalls: [{ toolName: "A" }, { toolName: "B" }] },
      { text: "done" },
    ]);
    const { history, run } = await setup([a, b], provider);
    await run("x");
    const results = history[2].parts;
    expect(results).toHaveLength(2);
    expect(results.map((p) => (p as { content: string }).content)).toEqual(["a", "b"]);
  });

  it("permission deny never reaches tool middleware", async () => {
    const write = fakeTool("Write", async () => ({ content: "written" }));
    const provider = scriptedProvider([
      { toolCalls: [{ toolName: "Write", args: { path: "a.ts" } }] },
      { text: "denied" },
    ]);
    const permission = new PermissionEngine({
      mode: "plan",
      decider: { ask: async () => "allow" },
    });
    const { toolsService, run } = await setup([write], provider, permission);
    const seen: string[] = [];
    toolsService.registerMiddleware({
      name: "spy",
      async execute(invocation, next) {
        seen.push(invocation.toolName);
        return next();
      },
    });

    const result = await run("write it");
    expect(result.finalText).toBe("denied");
    expect(write.calls).toHaveLength(0);
    expect(seen).toEqual([]);
  });

  it("wraps allowed tools with middleware and stamps invocation/resource/outcome on events", async () => {
    const echo: Tool = {
      name: "Echo",
      description: "Echo",
      readOnly: false,
      sideEffect: "unknown",
      parameters: { type: "object" },
      permissionResource: () => ({ action: "write", kind: "test", scope: "Echo" }),
      // Persisted args differ from raw ones — middleware must only see these.
      persistArgs: (args) => ({ msg: `persisted:${String(args.msg ?? "")}` }),
      execute: async (args) => ({ content: `echo:${String(args.msg ?? "")}` }),
    };
    const provider = scriptedProvider([
      { toolCalls: [{ toolName: "Echo", args: { msg: "hi" } }] },
      { text: "done" },
    ]);
    const { toolsService, events, run } = await setup([echo], provider);
    const seen: Array<{ toolName: string; persistedArgs: Record<string, unknown> }> = [];
    toolsService.registerMiddleware({
      name: "spy",
      async execute(invocation, next) {
        seen.push({ toolName: invocation.toolName, persistedArgs: invocation.persistedArgs });
        return next();
      },
    });

    await run("x");
    expect(seen).toEqual([{ toolName: "Echo", persistedArgs: { msg: "persisted:hi" } }]);

    const callEvent = events.find((e) => e.type === "toolCall");
    if (!callEvent || callEvent.type !== "toolCall") throw new Error("missing toolCall event");
    expect(callEvent.invocationId).toMatch(/^inv-/);
    const resultEvent = events.find((e) => e.type === "toolResult");
    if (!resultEvent || resultEvent.type !== "toolResult") throw new Error("missing toolResult event");
    expect(resultEvent).toMatchObject({
      outcome: "success",
      resource: { action: "write", kind: "test", scope: "Echo" },
      invocationId: callEvent.invocationId,
      isError: undefined,
    });
  });

  it("aborts runaway tools at the timeout and reports a timeout outcome", async () => {
    const hang = abortAwareTool("Hang");
    const provider = scriptedProvider([
      { toolCalls: [{ toolName: "Hang" }] },
      { text: "recovered" },
    ]);
    const { events, history, run } = await setup([hang], provider);

    const result = await run("x", { toolTimeoutMs: 20, abortGraceMs: 20 });
    expect(result.finalText).toBe("recovered");
    const tr = history[2].parts[0] as { isError?: boolean; content: string };
    expect(tr.isError).toBe(true);
    expect(tr.content).toContain("超时");
    const resultEvent = events.find((e) => e.type === "toolResult");
    expect(resultEvent && resultEvent.type === "toolResult" && resultEvent.outcome).toBe("timeout");
  });

  it("reports tools that ignore the abort as unstable", async () => {
    const zombie: Tool = {
      name: "Zombie",
      description: "Zombie",
      readOnly: false,
      sideEffect: "unknown",
      parameters: { type: "object" },
      permissionResource: () => ({ action: "write", kind: "test", scope: "Zombie" }),
      persistArgs: (args) => ({ ...args }),
      // Ignores the abort signal entirely: never settles.
      execute: () => new Promise<ToolResult>(() => {}),
    };
    const provider = scriptedProvider([
      { toolCalls: [{ toolName: "Zombie" }] },
      { text: "recovered" },
    ]);
    const { events, history, run } = await setup([zombie], provider);

    const result = await run("x", { toolTimeoutMs: 20, abortGraceMs: 20 });
    expect(result.finalText).toBe("recovered");
    const tr = history[2].parts[0] as { isError?: boolean; content: string };
    expect(tr.isError).toBe(true);
    expect(tr.content).toContain("TOOL_UNSTABLE");
    const resultEvent = events.find((e) => e.type === "toolResult");
    expect(resultEvent && resultEvent.type === "toolResult" && resultEvent.outcome).toBe("unstable");
  });

  it("reports an aborted outcome when the run is stopped mid-tool", async () => {
    const stop = new AbortController();
    const tool: Tool = {
      name: "Stop",
      description: "Stop",
      readOnly: false,
      sideEffect: "unknown",
      parameters: { type: "object" },
      permissionResource: () => ({ action: "write", kind: "test", scope: "Stop" }),
      persistArgs: (args) => ({ ...args }),
      execute: (_args, ctx) =>
        new Promise<ToolResult>((_resolve, reject) => {
          ctx.signal.addEventListener("abort", () => reject(ctx.signal.reason), { once: true });
          queueMicrotask(() => stop.abort());
        }),
    };
    const provider = scriptedProvider([
      { toolCalls: [{ toolName: "Stop" }] },
      { text: "never reached" },
    ]);
    const { events, history, run } = await setup([tool], provider);

    const result = await run("x", { signal: stop.signal });
    // Loop breaks on the next turn-top check; the aborted result is in history.
    const tr = history[2].parts[0] as { isError?: boolean; content: string };
    expect(tr.isError).toBe(true);
    expect(tr.content).toContain("中止");
    const resultEvent = events.find((e) => e.type === "toolResult");
    expect(resultEvent && resultEvent.type === "toolResult" && resultEvent.outcome).toBe("aborted");
    expect(result.finalText).toBe("");
    // M1: a mid-tool stop must surface in the loop result, not just in history.
    expect(result.aborted).toBe(true);
  });

  it("arms the grace window on parent stop so an abort-ignoring tool goes unstable without waiting out the timeout", async () => {
    const stop = new AbortController();
    const zombie: Tool = {
      name: "ZombieStop",
      description: "ZombieStop",
      readOnly: false,
      sideEffect: "unknown",
      parameters: { type: "object" },
      permissionResource: () => ({ action: "write", kind: "test", scope: "ZombieStop" }),
      persistArgs: (args) => ({ ...args }),
      // Stops the run shortly after start, then ignores every abort forever.
      execute: () => {
        setTimeout(() => stop.abort(), 5);
        return new Promise<ToolResult>(() => {});
      },
    };
    const provider = scriptedProvider([
      { toolCalls: [{ toolName: "ZombieStop" }] },
      { text: "recovered" },
    ]);
    const { events, history, run } = await setup([zombie], provider);

    // 60s timeout with a 25ms grace: without grace-on-parent-abort the loop
    // would block on the deadline and this test itself would time out.
    const result = await run("x", { signal: stop.signal, toolTimeoutMs: 60_000, abortGraceMs: 25 });
    expect(result.aborted).toBe(true);
    const tr = history[2].parts[0] as { isError?: boolean; content: string };
    expect(tr.isError).toBe(true);
    expect(tr.content).toContain("TOOL_UNSTABLE");
    const resultEvent = events.find((e) => e.type === "toolResult");
    expect(resultEvent && resultEvent.type === "toolResult" && resultEvent.outcome).toBe("unstable");
  });

  it("classifies non-abort-shaped failures during a parent stop as aborted, not error", async () => {
    const stop = new AbortController();
    const tool: Tool = {
      name: "OddStop",
      description: "OddStop",
      readOnly: false,
      sideEffect: "unknown",
      parameters: { type: "object" },
      permissionResource: () => ({ action: "write", kind: "test", scope: "OddStop" }),
      persistArgs: (args) => ({ ...args }),
      // Cancels with a PLAIN error when the run stops: the outcome must still
      // be "aborted" because the parent signal is what ended the invocation.
      execute: (_args, ctx) =>
        new Promise<ToolResult>((_resolve, reject) => {
          ctx.signal.addEventListener("abort", () => reject(new Error("worker cancelled")), {
            once: true,
          });
          queueMicrotask(() => stop.abort());
        }),
    };
    const provider = scriptedProvider([
      { toolCalls: [{ toolName: "OddStop" }] },
      { text: "after" },
    ]);
    const { events, history, run } = await setup([tool], provider);

    const result = await run("x", { signal: stop.signal });
    expect(result.aborted).toBe(true);
    const resultEvent = events.find((e) => e.type === "toolResult");
    expect(resultEvent && resultEvent.type === "toolResult" && resultEvent.outcome).toBe("aborted");
    const tr = history[2].parts[0] as { isError?: boolean; content: string };
    expect(tr.content).toContain("工具执行已中止");
    expect(tr.content).not.toContain("worker cancelled");
  });

  it("fail-closes remaining calls after a stop instead of consulting the permission chain", async () => {
    const stop = new AbortController();
    let asks = 0;
    const permission = new PermissionEngine({
      mode: "ask",
      decider: {
        ask: async () => {
          asks += 1;
          return "allow";
        },
      },
    });
    const slow: Tool = {
      name: "SlowStop",
      description: "SlowStop",
      readOnly: false,
      sideEffect: "unknown",
      parameters: { type: "object" },
      permissionResource: () => ({ action: "write", kind: "test", scope: "SlowStop" }),
      persistArgs: (args) => ({ ...args }),
      execute: (_args, ctx) =>
        new Promise<ToolResult>((_resolve, reject) => {
          ctx.signal.addEventListener("abort", () => reject(ctx.signal.reason), { once: true });
          queueMicrotask(() => stop.abort());
        }),
    };
    const follow = fakeTool("FollowUp", async () => ({ content: "followed" }));
    const provider = scriptedProvider([
      { toolCalls: [{ toolName: "SlowStop" }, { toolName: "FollowUp" }] },
      { text: "after" },
    ]);
    const { events, history, run } = await setup([slow, follow], provider, permission);

    const result = await run("x", { signal: stop.signal });
    // Only the in-flight call consulted permissions; the post-stop call was
    // fail-closed without prompting the user again.
    expect(asks).toBe(1);
    expect(follow.calls).toHaveLength(0);
    const results = history[2].parts as Array<{ content: string; isError?: boolean }>;
    expect(results[1]!.isError).toBe(true);
    expect(results[1]!.content).toContain("运行已中止");
    // R1: a user-stop termination is "aborted" on the machine-readable channel,
    // so outcome-aggregating hosts never count Stop presses as tool errors.
    const resultEvents = events.filter((e) => e.type === "toolResult");
    expect(
      resultEvents[1] && resultEvents[1].type === "toolResult" && resultEvents[1].outcome,
    ).toBe("aborted");
    expect(result.aborted).toBe(true);
  });

  it("delegated calls of one turn run in parallel (barrier handshake)", async () => {
    let aStarted!: () => void;
    let bStarted!: () => void;
    const aStart = new Promise<void>((resolve) => {
      aStarted = resolve;
    });
    const bStart = new Promise<void>((resolve) => {
      bStarted = resolve;
    });
    const delegated = (name: string, onStart: () => void, peer: Promise<void>): Tool => ({
      name,
      description: name,
      readOnly: false,
      sideEffect: "delegated",
      parameters: { type: "object" },
      permissionResource: () => ({ action: "spawn", kind: "agent", scope: name }),
      persistArgs: (args: Record<string, unknown>) => ({ ...args }),
      // Resolves only when the peer is ALSO in flight — a serial executor
      // deadlocks here and fails this test by timeout.
      async execute(): Promise<ToolResult> {
        onStart();
        await peer;
        return { content: name };
      },
    });
    const provider = scriptedProvider([
      { toolCalls: [{ toolName: "AgentA" }, { toolName: "AgentB" }] },
      { text: "done" },
    ]);
    const { history, run } = await setup(
      [delegated("AgentA", aStarted, bStart), delegated("AgentB", bStarted, aStart)],
      provider,
    );
    await run("x");
    const results = history[2].parts as Array<{ content: string }>;
    expect(results.map((part) => part.content)).toEqual(["AgentA", "AgentB"]);
  });

  it("results keep call order regardless of completion order", async () => {
    const shared = (name: string, delayMs: number): Tool => ({
      name,
      description: name,
      readOnly: true,
      sideEffect: "none",
      parameters: { type: "object" },
      permissionResource: () => ({ action: "read", kind: "test", scope: name }),
      persistArgs: (args: Record<string, unknown>) => ({ ...args }),
      async execute(): Promise<ToolResult> {
        if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
        return { content: name };
      },
    });
    const provider = scriptedProvider([
      { toolCalls: [{ toolName: "Slow" }, { toolName: "Fast" }] },
      { text: "done" },
    ]);
    const { history, run } = await setup([shared("Slow", 25), shared("Fast", 0)], provider);
    await run("x");
    // Fast settles first, but the persisted result order follows the call order.
    const results = history[2].parts as Array<{ content: string }>;
    expect(results.map((part) => part.content)).toEqual(["Slow", "Fast"]);
  });

  it("write-class calls are exclusive: they wait for shared calls and run alone", async () => {
    let readerSettled = false;
    const started: string[] = [];
    const reader = (name: string, delayMs: number): Tool => ({
      name,
      description: name,
      readOnly: true,
      sideEffect: "none",
      parameters: { type: "object" },
      permissionResource: () => ({ action: "read", kind: "test", scope: name }),
      persistArgs: (args: Record<string, unknown>) => ({ ...args }),
      async execute(): Promise<ToolResult> {
        started.push(name);
        if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
        if (name === "Peek") readerSettled = true;
        return { content: name };
      },
    });
    let writerSawReaderSettled = false;
    const writer: Tool = {
      name: "Mutate",
      description: "Mutate",
      readOnly: false,
      sideEffect: "paths",
      parameters: { type: "object" },
      permissionResource: () => ({ action: "write", kind: "test", scope: "Mutate" }),
      persistArgs: (args: Record<string, unknown>) => ({ ...args }),
      async execute(): Promise<ToolResult> {
        started.push("Mutate");
        writerSawReaderSettled = readerSettled;
        return { content: "mutated" };
      },
    };
    const provider = scriptedProvider([
      { toolCalls: [{ toolName: "Peek" }, { toolName: "Mutate" }, { toolName: "Peek2" }] },
      { text: "done" },
    ]);
    const { history, run } = await setup([reader("Peek", 25), writer, reader("Peek2", 0)], provider);
    await run("x");
    // Mutate started only after Peek settled, and Peek2 only after Mutate.
    expect(writerSawReaderSettled).toBe(true);
    expect(started).toEqual(["Peek", "Mutate", "Peek2"]);
    const results = history[2].parts as Array<{ content: string }>;
    expect(results.map((part) => part.content)).toEqual(["Peek", "mutated", "Peek2"]);
  });
});
