import {
  createAgentLoopPlugin,
  createRunLoop,
  type LoopDeps,
  type RunLoopFunction,
} from "@innocenceharness/harness-agent-loop";
import { Context } from "@innocenceharness/kernel";
import { PermissionEngine } from "@innocenceharness/harness-permissions";
import type { Delta, Provider, ProviderModel } from "@innocenceharness/harness-providers";
import { textMessage, type HarnessEvent } from "@innocenceharness/harness-session";
import { ToolsPlugin, type Tool } from "@innocenceharness/harness-tools";
import { convertArrayToReadableStream, MockLanguageModelV3 } from "ai/test";
import { describe, expect, it } from "vitest";

function fakeTool(
  name: string,
  behavior: (args: Record<string, unknown>) => Promise<{ content: string }>,
): Tool & { calls: number } {
  const t = {
    name,
    description: name,
    readOnly: false,
    sideEffect: "unknown" as const,
    parameters: { type: "object" },
    calls: 0,
    permissionResource: () => ({ action: "write" as const, kind: "test", scope: name }),
    async execute(args: Record<string, unknown>) {
      t.calls += 1;
      return behavior(args);
    },
  } as unknown as Tool & { calls: number };
  return t;
}

/** Provider whose every turn requests the same tool (maxTurns probe). */
function loopingProvider(): Provider {
  let i = 0;
  return {
    id: "looping",
    async *chat(): AsyncIterable<Delta> {
      i += 1;
      yield { type: "toolCall", id: `call_${i}`, toolName: "Loop", args: {} };
    },
  };
}

interface Turn {
  text?: string;
  toolCalls?: Array<{ toolName: string; args?: Record<string, unknown> }>;
}

function scriptedProvider(turns: Turn[]): Provider {
  let i = 0;
  return {
    id: "scripted",
    async *chat(): AsyncIterable<Delta> {
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

const allowAll = () =>
  new PermissionEngine({ mode: "auto", decider: { ask: async () => "deny" as const } });

/** Loads a tools service with one call-counting Loop tool and binds loop deps. */
async function makeDeps(overrides: Partial<LoopDeps> = {}): Promise<{ deps: LoopDeps; tool: Tool & { calls: number } }> {
  const kernel = new Context();
  await kernel.plugin(ToolsPlugin);
  const tool = fakeTool("Loop", async () => ({ content: "again" }));
  kernel.tools.register(tool);
  return {
    tool,
    deps: {
      tools: kernel.tools,
      permission: allowAll(),
      provider: loopingProvider(),
      history: [],
      systemPrompt: "test",
      workspaceRoot: "/tmp/ws",
      onEvent: () => {},
      ...overrides,
    },
  };
}

describe("loop service lifecycle on the kernel", () => {
  it("carries the spine plugin name \"harness-agent-loop\"", async () => {
    const plugin = createAgentLoopPlugin((await makeDeps()).deps);
    expect(plugin.name).toBe("harness-agent-loop");
  });

  it("publishes the run function under \"loop\" while its fiber is active", async () => {
    const ctx = new Context();
    await ctx.plugin(createAgentLoopPlugin((await makeDeps()).deps));
    expect(typeof ctx.loop).toBe("function");
  });

  it("withdraws the run function when the plugin fiber is disposed", async () => {
    const ctx = new Context();
    const fiber = await ctx.plugin(createAgentLoopPlugin((await makeDeps()).deps));
    const run = ctx.loop;
    expect((ctx as { loop?: RunLoopFunction }).loop).toBeDefined();
    await fiber.dispose();
    expect((ctx as { loop?: RunLoopFunction }).loop).toBeUndefined();
    // The detached run function stays callable (the loop is pure over deps).
    expect(typeof run).toBe("function");
  });
});

describe("createRunLoop binding", () => {
  it("lets per-run options override the session-level defaults", async () => {
    const { deps, tool } = await makeDeps({ maxTurns: 5 });
    const run = createRunLoop(deps);
    const result = await run(textMessage("user", "go"), { maxTurns: 2 });
    expect(result.turns).toBe(2);
    expect(tool.calls).toBe(2);
  });

  it("falls back to the deps default when the run passes no override", async () => {
    const { deps, tool } = await makeDeps({ maxTurns: 3 });
    const run = createRunLoop(deps);
    const result = await run(textMessage("user", "go"));
    expect(result.turns).toBe(3);
    expect(tool.calls).toBe(3);
  });

  it("resolves a function systemPrompt once per run", async () => {
    const systems: string[] = [];
    const provider: Provider = {
      id: "echo",
      async *chat(req): AsyncIterable<Delta> {
        systems.push(req.system);
        yield { type: "text", text: "ok" };
      },
    };
    let base = "first";
    const { deps } = await makeDeps({ provider, systemPrompt: () => base });
    const run = createRunLoop(deps);

    await run(textMessage("user", "q1"));
    base = "second";
    await run(textMessage("user", "q2"));

    expect(systems).toEqual(["first", "second"]);
  });

  it("shares one history ledger across runs of the same bound loop", async () => {
    const provider = scriptedProvider([{ text: "done" }]);
    const { deps } = await makeDeps({ provider });
    const run = createRunLoop(deps);
    await run(textMessage("user", "q1"));
    await run(textMessage("user", "q2"));
    expect(deps.history.map((m) => m.role)).toEqual(["user", "assistant", "user", "assistant"]);
  });
});

describe("createRunLoop systemSegments production wiring", () => {
  /** SDK 形态 provider（带 model 载体），单文本轮 finish 携带 usage——
   *  生产路径上唯一会产生 contextUsage 事件的形态。 */
  function usageProvider(inputTokens: {
    total: number;
    noCache: number;
    cacheRead: number;
  }): Provider & { model: ProviderModel } {
    const model = new MockLanguageModelV3({
      provider: "sdk-test",
      modelId: "sdk-model",
      async doStream() {
        return {
          stream: convertArrayToReadableStream([
            { type: "stream-start", warnings: [] },
            { type: "text-start", id: "text-1" },
            { type: "text-delta", id: "text-1", delta: "done" },
            {
              type: "finish",
              usage: {
                inputTokens: { ...inputTokens, cacheWrite: 0 },
                outputTokens: { total: 5, text: 5, reasoning: 0 },
              },
              finishReason: { unified: "stop", raw: "stop" },
            },
          ]),
        };
      },
    });
    return {
      id: "sdk-test",
      model: { value: model, providerId: "sdk-test", modelId: "sdk-model" },
      async *chat(): AsyncIterable<Delta> {
        throw new Error("legacy provider path must not run when a model is available");
      },
    };
  }

  const contextUsages = (events: HarnessEvent[]) =>
    events.filter(
      (event): event is Extract<HarnessEvent, { type: "contextUsage" }> =>
        event.type === "contextUsage",
    );

  it("经 createRunLoop 转发 systemSegments 后技能类计量非零（生产路径）", async () => {
    const events: HarnessEvent[] = [];
    const { deps } = await makeDeps({
      provider: usageProvider({ total: 500, noCache: 250, cacheRead: 250 }),
      onEvent: (event) => events.push(event),
      systemSegments: () => ({ skills: "技能索引段：review —— 代码审查指南" }),
    });
    const run = createRunLoop(deps);
    await run(textMessage("user", "hi"));

    const usages = contextUsages(events);
    expect(usages).toHaveLength(1);
    const snapshot = usages[0]!.snapshot;
    // LoopDeps.systemSegments 缺位时技能恒并入系统提示词类；转发后单列。
    expect(snapshot.breakdown.skills).toBeGreaterThan(0);
    expect(snapshot.inputTokens).toBe(500);
    // 校准不变量：六类之和恒等于真实输入。
    const sum = Object.values(snapshot.breakdown).reduce((a, b) => a + b, 0);
    expect(sum).toBe(500);
  });

  it("deps 缺省 systemSegments 时技能类为零（并入系统提示词类）", async () => {
    const events: HarnessEvent[] = [];
    const { deps } = await makeDeps({
      provider: usageProvider({ total: 500, noCache: 250, cacheRead: 250 }),
      onEvent: (event) => events.push(event),
    });
    const run = createRunLoop(deps);
    await run(textMessage("user", "hi"));

    const usages = contextUsages(events);
    expect(usages).toHaveLength(1);
    expect(usages[0]!.snapshot.breakdown.skills).toBe(0);
  });
});
