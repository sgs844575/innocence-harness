import {
  bindSubagentSpawner,
  createSpawnerPlugin,
  INHERIT_HISTORY_LIMIT,
  type SpawnerChildMaterials,
  type SpawnerChildSession,
  type SpawnerDeps,
  type SpawnerLogger,
  type SpawnerRunInput,
  type SpawnerService,
  type SpawnerSessionFactory,
  type SubagentChildEvent,
  type SubagentResult,
  type SubagentSpawner,
} from "@innocenceharness/harness-agent";
import { Context } from "@innocenceharness/kernel";
import { PermissionEngine } from "@innocenceharness/harness-permissions";
import type { Provider } from "@innocenceharness/harness-providers";
import type { MessageProcessor } from "@innocenceharness/harness-session";
import {
  createExecutionScope,
  type ExecutionScopeIdentity,
  type Tool,
  type ToolExecutionMiddleware,
} from "@innocenceharness/harness-tools";
import { describe, expect, it, vi } from "vitest";

// Service-level doubles: the spawner semantics are pinned through a
// sessionFactory test double that records what the service assembles.

const echoProvider: Provider = { id: "echo", async *chat() {} };

const allowEngine = () =>
  new PermissionEngine({ mode: "auto", decider: { ask: async () => "deny" as const } });

function fakeTool(name: string, readOnly = false): Tool {
  return {
    name,
    description: name,
    readOnly,
    sideEffect: readOnly ? ("none" as const) : ("unknown" as const),
    parameters: { type: "object" },
    permissionResource: () => ({
      action: readOnly ? "read" : "write",
      kind: "test",
      scope: name,
    }),
    persistArgs: (args) => ({ ...args }),
    async execute() {
      return { content: `${name}-done` };
    },
  };
}

const fakeProcessor = (name: string): MessageProcessor => ({
  name,
  order: 0,
  async process(message) {
    return message;
  },
});

const fakeMiddleware = (name: string): ToolExecutionMiddleware => ({
  name,
  async execute(_invocation, next) {
    return next();
  },
});

/** What the factory observed for one spawned child. */
interface ChildRecord {
  materials: SpawnerChildMaterials;
  runs: Array<{ prompt: string; signal: AbortSignal | undefined; identity: ExecutionScopeIdentity }>;
  disposeCalls: number;
}

/**
 * Factory double: every created child parks its run on a per-child gate the
 * test releases (`gates[i]()`), so concurrency windows are controllable.
 */
function makeFactory(
  script: { runResult?: SubagentResult; runError?: Error; disposeError?: Error; childEvents?: SubagentChildEvent[] } = {},
): { factory: SpawnerSessionFactory; children: ChildRecord[]; gates: Array<() => void> } {
  const children: ChildRecord[] = [];
  const gates: Array<() => void> = [];
  const factory: SpawnerSessionFactory = async (materials) => {
    const record: ChildRecord = { materials, runs: [], disposeCalls: 0 };
    children.push(record);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    gates.push(release);
    const child: SpawnerChildSession = {
      run: async (prompt, signal, identity, onEvent) => {
        record.runs.push({ prompt, signal, identity });
        await gate;
        for (const event of script.childEvents ?? []) onEvent?.(event);
        if (script.runError) throw script.runError;
        return script.runResult ?? { finalText: "子代理报告", turns: 1 };
      },
      dispose: async () => {
        record.disposeCalls += 1;
        if (script.disposeError) throw script.disposeError;
      },
    };
    return child;
  };
  return { factory, children, gates };
}

/** Loads the spawner plugin into a fresh kernel context. */
async function withSpawner(overrides: Partial<SpawnerDeps> = {}): Promise<Context> {
  const ctx = new Context();
  await ctx.plugin(
    createSpawnerPlugin({
      sessionFactory: makeFactory().factory,
      provider: echoProvider,
      permission: allowEngine(),
      tools: [],
      ...overrides,
    }),
  );
  return ctx;
}

const baseInput: SpawnerRunInput = {
  systemPrompt: "只读研究代理",
  prompt: "去查",
  tools: "all",
  inherit: { processors: [], middlewares: [] },
};

/** Runs one spawn through the service and releases the parked child. */
async function runOne(
  ctx: Context,
  gates: Array<() => void>,
  input: SpawnerRunInput = baseInput,
): Promise<SubagentResult> {
  const pending = ctx.spawner.run(input);
  await vi.waitFor(() => expect(gates.length).toBeGreaterThanOrEqual(1));
  gates.shift()!();
  return pending;
}

describe("spawner lifecycle port", () => {
  it("publishes child identity, real text deltas, and terminal status", async () => {
    const lifecycle: import("@innocenceharness/harness-agent").SubagentLifecycleEvent[] = [];
    const { factory, gates } = makeFactory({ childEvents: [{ type: "text", text: "真实增量" }] });
    const ctx = await withSpawner({
      sessionFactory: factory,
      lifecycle: { emit: (event) => lifecycle.push(event) },
    });

    const pending = ctx.spawner.run({ ...baseInput, description: "研究任务", sessionId: "parent-1" });
    await vi.waitFor(() => expect(gates).toHaveLength(1));
    gates[0]!();
    await expect(pending).resolves.toEqual({ finalText: "子代理报告", turns: 1 });

    expect(lifecycle[0]).toMatchObject({
      childId: expect.any(String),
      parentSessionId: "parent-1",
      description: "研究任务",
      status: "started",
    });
    expect(lifecycle[1]).toMatchObject({ status: "running" });
    expect(lifecycle).toContainEqual(expect.objectContaining({ status: "running", delta: "真实增量" }));
    expect(lifecycle.at(-1)).toMatchObject({ status: "completed", final: "子代理报告" });
  });

  it("carries agentType/prompt on started and parentInvocationId on every event, forwarding child tool activity", async () => {
    const lifecycle: import("@innocenceharness/harness-agent").SubagentLifecycleEvent[] = [];
    const { factory, gates } = makeFactory({
      childEvents: [
        { type: "toolCall", name: "Read", args: { file_path: "D:/repo/src/a.ts" } },
        { type: "toolResult", name: "Read", isError: false, result: "文件内容摘录" },
        { type: "text", text: "结论" },
      ],
    });
    const ctx = await withSpawner({
      sessionFactory: factory,
      lifecycle: { emit: (event) => lifecycle.push(event) },
    });
    const parentScope = createExecutionScope("Task", "inv-42", { sessionId: "sess-7" });

    const pending = ctx.spawner.run({
      ...baseInput,
      agentType: "explore",
      description: "定位渲染",
      parentScope,
    });
    await vi.waitFor(() => expect(gates).toHaveLength(1));
    gates[0]!();
    await pending;

    expect(lifecycle[0]).toMatchObject({
      status: "started",
      agentType: "explore",
      prompt: "去查",
      parentInvocationId: "inv-42",
      parentSessionId: "sess-7",
    });
    // agentType/prompt 只在 started 上；parentInvocationId 每个事件都有。
    expect(lifecycle.at(-1)).toMatchObject({ status: "completed", parentInvocationId: "inv-42" });
    expect(lifecycle.at(-1)?.agentType).toBeUndefined();
    expect(lifecycle).toContainEqual(
      expect.objectContaining({
        status: "running",
        tool: { name: "Read", phase: "call", title: "a.ts" },
      }),
    );
    expect(lifecycle).toContainEqual(
      expect.objectContaining({
        status: "running",
        tool: { name: "Read", phase: "result", isError: false, result: "文件内容摘录" },
      }),
    );
  });

  it("emits exactly one failed terminal status when the child reports a fatal error", async () => {
    const lifecycle: import("@innocenceharness/harness-agent").SubagentLifecycleEvent[] = [];
    const { factory, gates } = makeFactory({
      childEvents: [
        { type: "error", error: "模型失败" },
        { type: "error", error: "模型失败（重复）" },
      ],
      runResult: { finalText: "子代理报告", turns: 1, completion: { finishReason: "error", aborted: false } },
    });
    const ctx = await withSpawner({
      sessionFactory: factory,
      lifecycle: { emit: (event) => lifecycle.push(event) },
    });

    const pending = ctx.spawner.run({ ...baseInput, sessionId: "parent-failed" });
    await vi.waitFor(() => expect(gates).toHaveLength(1));
    gates[0]!();
    await expect(pending).resolves.toEqual({
      finalText: "子代理报告",
      turns: 1,
      completion: { finishReason: "error", aborted: false },
    });

    expect(lifecycle.filter((event) => event.status === "failed")).toHaveLength(1);
    expect(lifecycle.filter((event) => ["completed", "failed", "cancelled"].includes(event.status))).toHaveLength(1);
  });

  it("emits exactly one cancelled terminal status when the parent signal aborts", async () => {
    const lifecycle: import("@innocenceharness/harness-agent").SubagentLifecycleEvent[] = [];
    const { factory, gates } = makeFactory();
    const ctx = await withSpawner({
      sessionFactory: factory,
      lifecycle: { emit: (event) => lifecycle.push(event) },
    });
    const controller = new AbortController();
    const pending = ctx.spawner.run({ ...baseInput, sessionId: "parent-cancelled", signal: controller.signal });
    await vi.waitFor(() => expect(gates).toHaveLength(1));
    controller.abort();
    gates[0]!();
    await expect(pending).resolves.toEqual({ finalText: "子代理报告", turns: 1 });

    expect(lifecycle.filter((event) => event.status === "cancelled")).toHaveLength(1);
    expect(lifecycle.filter((event) => ["completed", "failed", "cancelled"].includes(event.status))).toHaveLength(1);
  });

  it("keeps child ids unique across spawners sharing a parent session", async () => {
    const firstParts = makeFactory();
    const secondParts = makeFactory();
    const lifecycleA: import("@innocenceharness/harness-agent").SubagentLifecycleEvent[] = [];
    const lifecycleB: import("@innocenceharness/harness-agent").SubagentLifecycleEvent[] = [];
    const first = await withSpawner({ sessionFactory: firstParts.factory, lifecycle: { emit: (event) => lifecycleA.push(event) } });
    const second = await withSpawner({ sessionFactory: secondParts.factory, lifecycle: { emit: (event) => lifecycleB.push(event) } });
    const firstRun = first.spawner.run({ ...baseInput, sessionId: "same-parent" });
    const secondRun = second.spawner.run({ ...baseInput, sessionId: "same-parent" });
    await vi.waitFor(() => expect(lifecycleA.some((event) => event.status === "started")).toBe(true));
    await vi.waitFor(() => expect(lifecycleB.some((event) => event.status === "started")).toBe(true));
    expect(lifecycleA[0]!.childId).not.toBe(lifecycleB[0]!.childId);
    firstParts.gates[0]!();
    secondParts.gates[0]!();
    await Promise.all([firstRun, secondRun]);
  });

  it("disposes a child that resolves after parent cancellation during construction", async () => {
    const lifecycle: import("@innocenceharness/harness-agent").SubagentLifecycleEvent[] = [];
    let release!: () => void;
    const construction = new Promise<void>((resolve) => { release = resolve; });
    let disposeCalls = 0;
    let factoryCalled!: () => void;
    const called = new Promise<void>((resolve) => { factoryCalled = resolve; });
    const factory: SpawnerSessionFactory = async () => {
      factoryCalled();
      await construction;
      return {
        run: async () => ({ finalText: "late", turns: 1 }),
        dispose: async () => { disposeCalls += 1; },
      };
    };
    const ctx = await withSpawner({ sessionFactory: factory, lifecycle: { emit: (event) => lifecycle.push(event) } });
    const controller = new AbortController();
    const pending = ctx.spawner.run({ ...baseInput, signal: controller.signal });
    await called;
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    release();
    await vi.waitFor(() => expect(disposeCalls).toBe(1));
    expect(lifecycle.filter((event) => ["completed", "failed", "cancelled"].includes(event.status))).toHaveLength(1);
    expect(lifecycle.at(-1)?.status).toBe("cancelled");
  });
});

describe("spawner child plugin set construction", () => {
  it("selects child tools from the parent set and always excludes Task", async () => {
    const task = fakeTool("Task");
    const read = fakeTool("Read", true);
    const write = fakeTool("Write");
    const seek = fakeTool("Seek", true);
    const { factory, children, gates } = makeFactory();
    const ctx = await withSpawner({
      sessionFactory: factory,
      tools: [task, read, write, seek],
    });

    // Named selection keeps the parent registration order.
    await runOne(ctx, gates, { ...baseInput, tools: ["Write", "Read"] });
    expect(children[0]!.materials.tools).toEqual([read, write]);
    // "all" takes everything except Task itself.
    await runOne(ctx, gates, { ...baseInput, tools: "all" });
    expect(children[1]!.materials.tools).toEqual([read, write, seek]);
    // "readOnly" keeps only readOnly tools, Task still excluded.
    await runOne(ctx, gates, { ...baseInput, tools: "readOnly" });
    expect(children[2]!.materials.tools).toEqual([read, seek]);
    // Unknown names drop out silently (the original filter semantics).
    await runOne(ctx, gates, { ...baseInput, tools: ["Read", "Ghost"] });
    expect(children[3]!.materials.tools).toEqual([read]);
    expect(children.some((c) => c.materials.tools.includes(task))).toBe(false);
  });

  it("passes the inherited processors and middlewares through unchanged, in order", async () => {
    const p1 = fakeProcessor("p1");
    const p2 = fakeProcessor("p2");
    const m1 = fakeMiddleware("m1");
    const m2 = fakeMiddleware("m2");
    const { factory, children, gates } = makeFactory();
    const ctx = await withSpawner({ sessionFactory: factory });

    await runOne(ctx, gates, {
      ...baseInput,
      inherit: { processors: [p1, p2], middlewares: [m1, m2] },
    });

    // Same objects, same order — the child registers the parent's set as-is.
    expect(children[0]!.materials.processors).toHaveLength(2);
    expect(children[0]!.materials.processors[0]).toBe(p1);
    expect(children[0]!.materials.processors[1]).toBe(p2);
    expect(children[0]!.materials.middlewares).toHaveLength(2);
    expect(children[0]!.materials.middlewares[0]).toBe(m1);
    expect(children[0]!.materials.middlewares[1]).toBe(m2);
  });

  it("shares the parent provider and permission engine with the child", async () => {
    const provider: Provider = { id: "shared", async *chat() {} };
    const permission = allowEngine();
    const { factory, children, gates } = makeFactory();
    const ctx = await withSpawner({ sessionFactory: factory, provider, permission });

    await runOne(ctx, gates);

    // The very instances are handed over — shared rules, grants and mode.
    expect(children[0]!.materials.provider).toBe(provider);
    expect(children[0]!.materials.permission).toBe(permission);
  });

  it("defaults the child maxTurns to 20 and honors an explicit cap", async () => {
    const { factory, children, gates } = makeFactory();
    const ctx = await withSpawner({ sessionFactory: factory });

    await runOne(ctx, gates);
    expect(children[0]!.materials.maxTurns).toBe(20);
    await runOne(ctx, gates, { ...baseInput, maxTurns: 7 });
    expect(children[1]!.materials.maxTurns).toBe(7);
  });

  it("passes the spawn system prompt to the child materials", async () => {
    const { factory, children, gates } = makeFactory();
    const ctx = await withSpawner({ sessionFactory: factory });

    await runOne(ctx, gates, { ...baseInput, systemPrompt: "规划子代理" });
    expect(children[0]!.materials.systemPrompt).toBe("规划子代理");
  });
});

describe("spawner run semantics", () => {
  it("runs the child prompt under the parent-derived identity, propagating parent abort", async () => {
    const { factory, children, gates } = makeFactory();
    const ctx = await withSpawner({ sessionFactory: factory });
    const parentScope = createExecutionScope("Task", "inv-9", {
      sessionId: "sess-1",
      taskId: "task-9",
      routeId: "route-4",
    });
    const parent = new AbortController();

    const pending = ctx.spawner.run({ ...baseInput, parentScope, signal: parent.signal });
    await vi.waitFor(() => expect(gates.length).toBeGreaterThanOrEqual(1));
    // The child runs on the run's own derived controller (cancel reaches it
    // after the spawning call is gone); the parent signal propagates into it.
    const childSignal = children[0]!.runs[0]!.signal;
    expect(childSignal).toBeDefined();
    expect(childSignal!.aborted).toBe(false);
    parent.abort();
    expect(childSignal!.aborted).toBe(true);
    gates.shift()!();
    await pending;
    expect(children[0]!.runs[0]!.prompt).toBe("去查");
    expect(children[0]!.runs[0]!.identity).toEqual({
      sessionId: "sess-1",
      taskId: "task-9",
      routeId: "route-4",
      parentInvocationId: "inv-9",
    });

    // Without a parent scope the identity falls back to the input's sessionId.
    await runOne(ctx, gates, { ...baseInput, sessionId: "sess-host" });
    expect(children[1]!.runs[0]!.identity).toEqual({ sessionId: "sess-host" });
  });

  it("returns the child run summary as the subagent result", async () => {
    const { factory, gates } = makeFactory({
      runResult: { finalText: "子代理报告：找到了", turns: 3 },
    });
    const ctx = await withSpawner({ sessionFactory: factory });

    await expect(runOne(ctx, gates)).resolves.toEqual({
      finalText: "子代理报告：找到了",
      turns: 3,
    });
  });
});

describe("spawner concurrency cap", () => {
  it("caps concurrent spawns; excess spawns queue FIFO until a slot frees", async () => {
    const { factory, children, gates } = makeFactory();
    const ctx = await withSpawner({ sessionFactory: factory });

    const first = ctx.spawner.run(baseInput);
    const second = ctx.spawner.run(baseInput);
    const third = ctx.spawner.run(baseInput);
    await vi.waitFor(() => expect(children).toHaveLength(3));
    // At the cap the fourth spawn waits for a slot instead of failing.
    const fourth = ctx.spawner.run(baseInput);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(children).toHaveLength(3);

    gates[0]!();
    await first;
    // The settled child released its slot: the queued spawn is admitted.
    await vi.waitFor(() => expect(children).toHaveLength(4));
    gates[1]!();
    gates[2]!();
    gates[3]!();
    await Promise.all([second, third, fourth]);
    expect(children.every((c) => c.disposeCalls === 1)).toBe(true);
  });

  it("honors an injected concurrency cap", async () => {
    const { factory, children, gates } = makeFactory();
    const ctx = await withSpawner({ sessionFactory: factory, concurrency: 1 });

    const first = ctx.spawner.run(baseInput);
    await vi.waitFor(() => expect(children).toHaveLength(1));
    const second = ctx.spawner.run(baseInput);
    await new Promise((resolve) => setTimeout(resolve, 20));
    // Queued, not failed: no second child while the first holds the slot.
    expect(children).toHaveLength(1);

    gates[0]!();
    await first;
    await vi.waitFor(() => expect(children).toHaveLength(2));
    gates[1]!();
    await second;
  });

  it("releases the slot when the child run fails", async () => {
    const { factory, gates } = makeFactory({ runError: new Error("run-boom") });
    const ctx = await withSpawner({ sessionFactory: factory, concurrency: 1 });

    const first = ctx.spawner.run(baseInput);
    await vi.waitFor(() => expect(gates).toHaveLength(1));
    gates[0]!();
    await expect(first).rejects.toThrow("run-boom");

    // The failed child released its slot: the next spawn is admitted.
    const second = ctx.spawner.run(baseInput);
    await vi.waitFor(() => expect(gates).toHaveLength(2));
    gates[1]!();
    await expect(second).rejects.toThrow("run-boom");
  });
});

describe("context inheritance (S2b)", () => {
  it("bindSubagentSpawner fulfills inheritContext into a bounded history tail", async () => {
    const calls: Array<Record<string, unknown>> = [];
    const inner: SubagentSpawner = {
      run: async (options) => {
        calls.push(options as unknown as Record<string, unknown>);
        return { finalText: "ok", turns: 1 };
      },
    };
    const history: import("@innocenceharness/harness-session").Message[] = Array.from(
      { length: 80 },
      (_, i) => ({ role: "user" as const, parts: [{ type: "text" as const, text: `m${i}` }] }),
    );
    const bound = bindSubagentSpawner(
      inner,
      createExecutionScope("Task"),
      () => [...history],
    );
    await bound.run({
      systemPrompt: "s",
      tools: "all",
      prompt: "p",
      inheritContext: true,
    });
    const inherited = calls[0]!.inheritHistory as unknown[];
    expect(inherited).toHaveLength(INHERIT_HISTORY_LIMIT);
    // 近因优先：尾部保序，首条是裁剪后的最早消息。
    expect((inherited[0] as { parts: Array<{ text: string }> }).parts[0]!.text).toBe(
      `m${history.length - INHERIT_HISTORY_LIMIT}`,
    );
  });

  it("inheritContext without a bound history accessor degrades to a fresh context", async () => {
    const calls: Array<Record<string, unknown>> = [];
    const inner: SubagentSpawner = {
      run: async (options) => {
        calls.push(options as unknown as Record<string, unknown>);
        return { finalText: "ok", turns: 1 };
      },
    };
    const bound = bindSubagentSpawner(inner, createExecutionScope("Task"));
    await bound.run({ systemPrompt: "s", tools: "all", prompt: "p", inheritContext: true });
    expect(calls[0]!.inheritHistory).toBeUndefined();
    expect(calls[0]!.inheritContext).toBe(true);
  });

  it("forwards start/runs/wait with the same scope and history binding", async () => {
    const started: Array<Record<string, unknown>> = [];
    const scope = createExecutionScope("Task");
    const inner: SubagentSpawner = {
      run: async () => ({ finalText: "ok", turns: 1 }),
      start: (options) => {
        started.push(options as unknown as Record<string, unknown>);
        return { runId: "r1", done: Promise.resolve({ finalText: "ok", turns: 1 }) };
      },
      runs: () => [],
      wait: async (runId) => ({
        runId,
        description: "",
        status: "completed",
        startedAt: 0,
        toolCalls: 0,
      }),
    };
    const bound = bindSubagentSpawner(inner, scope, () => [
      { role: "user", parts: [{ type: "text", text: "父消息" }] },
    ]);
    const handle = bound.start!({
      systemPrompt: "s",
      tools: "all",
      prompt: "p",
      inheritContext: true,
    });
    expect(handle.runId).toBe("r1");
    expect(started[0]!.parentScope).toBe(scope);
    expect(started[0]!.inheritHistory).toHaveLength(1);
    expect(bound.runs!()).toEqual([]);
    await expect(bound.wait!("r1")).resolves.toMatchObject({ runId: "r1" });
    // A spawner without the registry faces stays run-only when bound.
    const runOnly = bindSubagentSpawner({ run: inner.run }, scope);
    expect(runOnly.start).toBeUndefined();
    expect(runOnly.runs).toBeUndefined();
    expect(runOnly.wait).toBeUndefined();
  });

  it("service passes seedHistory into materials and prefixes the briefing to the prompt", async () => {
    const { factory, children, gates } = makeFactory();
    const ctx = await withSpawner({ sessionFactory: factory });
    const seedHistory: import("@innocenceharness/harness-session").Message[] = [
      { role: "user", parts: [{ type: "text", text: "父会话消息" }] },
    ];
    await runOne(ctx, gates, {
      ...baseInput,
      inheritHistory: seedHistory,
    });
    expect(children[0]!.materials.seedHistory).toEqual(seedHistory);
    expect(children[0]!.runs[0]!.prompt.startsWith("[Inherited context]")).toBe(true);
    expect(children[0]!.runs[0]!.prompt).toContain("去查");
  });

  it("service omits seedHistory and the briefing when nothing is inherited", async () => {
    const { factory, children, gates } = makeFactory();
    const ctx = await withSpawner({ sessionFactory: factory });
    await runOne(ctx, gates);
    expect(children[0]!.materials.seedHistory).toBeUndefined();
    expect(children[0]!.runs[0]!.prompt).toBe("去查");
  });

  it("sanitizes the seed: window-head orphan result turns and trailing unanswered call turns are dropped", async () => {
    const { factory, children, gates } = makeFactory();
    const ctx = await withSpawner({ sessionFactory: factory });
    await runOne(ctx, gates, {
      ...baseInput,
      inheritHistory: [
        // 窗口头部孤儿：结果轮的调用在窗口外（toSdkMessages 会抛
        // "Tool result has no matching call"）。
        { role: "user", parts: [{ type: "toolResult", toolCallId: "outside", content: "r", isError: false }] },
        { role: "user", parts: [{ type: "text", text: "完好用户轮" }] },
        { role: "assistant", parts: [{ type: "text", text: "完好答复" }] },
        // 尾部悬空：派生调用本身——其结果在快照后才落地（原生协议 400）。
        { role: "assistant", parts: [{ type: "toolCall", id: "task-1", toolName: "Task", args: {} }] },
      ],
    });
    expect(children[0]!.materials.seedHistory).toEqual([
      { role: "user", parts: [{ type: "text", text: "完好用户轮" }] },
      { role: "assistant", parts: [{ type: "text", text: "完好答复" }] },
    ]);
  });

  it("sanitized seeds keep every tool result paired with a preceding in-window call (provider-valid first request)", async () => {
    const { factory, children, gates } = makeFactory();
    const ctx = await withSpawner({ sessionFactory: factory });
    await runOne(ctx, gates, {
      ...baseInput,
      inheritHistory: [
        { role: "assistant", parts: [{ type: "toolCall", id: "c1", toolName: "Read", args: {} }] },
        { role: "user", parts: [{ type: "toolResult", toolCallId: "c1", content: "内容", isError: false }] },
        { role: "assistant", parts: [{ type: "text", text: "结论" }] },
        { role: "assistant", parts: [{ type: "toolCall", id: "task-9", toolName: "Task", args: {} }] },
      ],
    });
    const seed = children[0]!.materials.seedHistory!;
    const callIds = new Set<string>();
    for (const message of seed) {
      for (const part of message.parts) {
        if (part.type === "toolCall") callIds.add(part.id);
        if (part.type === "toolResult") {
          // 不变量即 toSdkMessages 的配对要求：结果必须命中窗口内先前调用。
          expect(callIds.has(part.toolCallId)).toBe(true);
        }
      }
    }
    const last = seed[seed.length - 1]!;
    expect(last.role === "assistant" && last.parts.some((p) => p.type === "toolCall")).toBe(false);
  });

  it("a seed that sanitizes to nothing plants no history and no briefing", async () => {
    const { factory, children, gates } = makeFactory();
    const ctx = await withSpawner({ sessionFactory: factory });
    await runOne(ctx, gates, {
      ...baseInput,
      inheritHistory: [
        { role: "assistant", parts: [{ type: "toolCall", id: "task-1", toolName: "Task", args: {} }] },
      ],
    });
    expect(children[0]!.materials.seedHistory).toBeUndefined();
    expect(children[0]!.runs[0]!.prompt).toBe("去查");
  });
});

describe("spawner child disposal", () => {
  it("disposes the child in a finally after a successful run, swallowing dispose errors", async () => {
    const disposeError = new Error("dispose-boom");
    const logs: Array<{ level: string; msg: string; data?: unknown }> = [];
    const logger: SpawnerLogger = (level, msg, data) => logs.push({ level, msg, data });
    const { factory, children, gates } = makeFactory({ disposeError });
    const ctx = await withSpawner({ sessionFactory: factory, logger });

    await expect(runOne(ctx, gates)).resolves.toEqual({ finalText: "子代理报告", turns: 1 });
    expect(children[0]!.disposeCalls).toBe(1);
    // The swallowed dispose failure is still reported through the logger.
    expect(logs).toContainEqual({
      level: "error",
      msg: "subagent child dispose failed",
      data: disposeError,
    });
  });

  it("never masks the child run's original error with a dispose failure", async () => {
    const disposeError = new Error("dispose-boom");
    const logs: Array<{ level: string; msg: string }> = [];
    const logger: SpawnerLogger = (level, msg) => logs.push({ level, msg });
    const { factory, children, gates } = makeFactory({
      runError: new Error("run-boom"),
      disposeError,
    });
    const ctx = await withSpawner({ sessionFactory: factory, logger });

    await expect(runOne(ctx, gates)).rejects.toThrow("run-boom");
    expect(children[0]!.disposeCalls).toBe(1);
    expect(logs).toContainEqual({ level: "error", msg: "subagent child dispose failed" });
  });
});

describe("spawner service lifecycle on the kernel", () => {
  it("carries the plugin name \"harness-spawner\"", () => {
    const plugin = createSpawnerPlugin({
      sessionFactory: makeFactory().factory,
      provider: echoProvider,
      permission: allowEngine(),
      tools: [],
    });
    expect(plugin.name).toBe("harness-spawner");
  });

  it("publishes the service under \"spawner\" while its fiber is active", async () => {
    const ctx = await withSpawner();
    expect((ctx as { spawner?: SpawnerService }).spawner).toBeDefined();
    expect(typeof ctx.spawner.run).toBe("function");
  });

  it("withdraws the service when the plugin fiber is disposed", async () => {
    const ctx = new Context();
    const { factory, gates } = makeFactory();
    const fiber = await ctx.plugin(
      createSpawnerPlugin({
        sessionFactory: factory,
        provider: echoProvider,
        permission: allowEngine(),
        tools: [],
      }),
    );
    const service = ctx.spawner;
    expect((ctx as { spawner?: SpawnerService }).spawner).toBeDefined();
    await fiber.dispose();
    expect((ctx as { spawner?: SpawnerService }).spawner).toBeUndefined();
    // The detached service object stays usable (its concurrency slot lives on).
    const pending = service.run(baseInput);
    await vi.waitFor(() => expect(gates).toHaveLength(1));
    gates[0]!();
    await expect(pending).resolves.toEqual({ finalText: "子代理报告", turns: 1 });
  });

  it("unwinding the plugin aborts every live run (detached children never leak)", async () => {
    const ctx = new Context();
    const { factory, children, gates } = makeFactory();
    const fiber = await ctx.plugin(
      createSpawnerPlugin({
        sessionFactory: factory,
        provider: echoProvider,
        permission: allowEngine(),
        tools: [],
      }),
    );
    const handle = ctx.spawner.start(baseInput);
    await vi.waitFor(() => expect(children).toHaveLength(1));
    await fiber.dispose();
    // The per-run controller aborted: the parked child sees it once released.
    expect(children[0]!.runs[0]!.signal?.aborted).toBe(true);
    gates[0]!();
    await handle.done;
  });
});

describe("spawner run registry", () => {
  it("start detaches: returns a runId immediately and tracks the run to completion", async () => {
    const { factory, children, gates } = makeFactory({
      childEvents: [
        { type: "toolCall", name: "Glob" },
        { type: "toolResult", name: "Glob", isError: false },
      ],
    });
    const ctx = await withSpawner({ sessionFactory: factory });

    const handle = ctx.spawner.start({ ...baseInput, description: "列目录" });
    expect(handle.runId).toMatch(/^child_/);
    await vi.waitFor(() => expect(children).toHaveLength(1));
    await vi.waitFor(() => expect(ctx.spawner.runs()[0]?.status).toBe("running"));
    expect(ctx.spawner.runs()[0]).toMatchObject({
      runId: handle.runId,
      description: "列目录",
      status: "running",
    });

    gates[0]!();
    await expect(handle.done).resolves.toEqual({ finalText: "子代理报告", turns: 1 });
    const info = await ctx.spawner.wait(handle.runId);
    expect(info.status).toBe("completed");
    expect(info.final).toBe("子代理报告");
    expect(info.turns).toBe(1);
    expect(info.toolCalls).toBe(1);
    expect(info.lastActivity).toBe("tool Glob result");
    expect(info.finishedAt).toBeTypeOf("number");
  });

  it("blocking runs queue no progress notes; detached runs do, latest-wins", async () => {
    const { factory, gates } = makeFactory();
    const ctx = await withSpawner({ sessionFactory: factory });

    const blocking = ctx.spawner.run(baseInput);
    await vi.waitFor(() => expect(gates).toHaveLength(1));
    gates[0]!();
    await blocking;
    expect(ctx.spawner.drainProgress()).toEqual([]);

    const handle = ctx.spawner.start({ ...baseInput, description: "后台" });
    await vi.waitFor(() => expect(gates).toHaveLength(2));
    const early = ctx.spawner.drainProgress();
    expect(early).toHaveLength(1);
    expect(early[0]).toContain("started");
    expect(early[0]).toContain("后台");

    gates[1]!();
    await handle.done;
    const late = ctx.spawner.drainProgress();
    expect(late).toHaveLength(1);
    expect(late[0]).toContain("completed");
    expect(late[0]).toContain("子代理报告");
    // Drained notes are cleared.
    expect(ctx.spawner.drainProgress()).toEqual([]);
  });

  it("wait blocks until terminal; a deadline resolves with the live snapshot", async () => {
    const { factory, gates } = makeFactory();
    const ctx = await withSpawner({ sessionFactory: factory });

    const handle = ctx.spawner.start(baseInput);
    await vi.waitFor(() => expect(gates).toHaveLength(1));
    const timedOut = await ctx.spawner.wait(handle.runId, 20);
    expect(timedOut.status).not.toBe("completed");

    const parked = ctx.spawner.wait(handle.runId);
    gates[0]!();
    const info = await parked;
    expect(info.status).toBe("completed");
    await handle.done;
    await expect(ctx.spawner.wait("missing")).rejects.toThrow("未知的子代理运行");
  });

  it("cancel aborts a live run; terminal or unknown runs are safe no-ops/errors", async () => {
    const { factory, children, gates } = makeFactory();
    const ctx = await withSpawner({ sessionFactory: factory });

    const handle = ctx.spawner.start(baseInput);
    await vi.waitFor(() => expect(children).toHaveLength(1));
    ctx.spawner.cancel(handle.runId);
    expect(children[0]!.runs[0]!.signal?.aborted).toBe(true);
    gates[0]!();
    await handle.done;
    expect(ctx.spawner.runs()[0]!.status).toBe("cancelled");
    // Cancelling a terminal run does not throw; unknown ids do.
    expect(ctx.spawner.cancel(handle.runId).status).toBe("cancelled");
    expect(() => ctx.spawner.cancel("missing")).toThrow("未知的子代理运行");
  });

  it("drops inheritToSubagents:false processors from the child set", async () => {
    const { factory, children, gates } = makeFactory();
    const ctx = await withSpawner({ sessionFactory: factory });

    const parentOnly: MessageProcessor = {
      ...fakeProcessor("parent-only"),
      inheritToSubagents: false,
    };
    const shared = fakeProcessor("shared");
    const pending = ctx.spawner.run({
      ...baseInput,
      inherit: { processors: [parentOnly, shared], middlewares: [] },
    });
    await vi.waitFor(() => expect(gates).toHaveLength(1));
    gates[0]!();
    await pending;
    expect(children[0]!.materials.processors.map((p) => p.name)).toEqual(["shared"]);
  });
});
