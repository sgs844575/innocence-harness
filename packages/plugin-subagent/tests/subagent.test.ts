import { describe, expect, it, vi } from "vitest";
import { Context } from "@innocenceharness/kernel";
import { ToolsPlugin } from "@innocenceharness/harness-tools";
import { AgentSession } from "@innocenceharness/harness-electron";
import { createTestSession } from "../../harness-electron/tests/helpers/testSession";
import {
  createExecutionScope,
  type ExecutionScope,
  type Tool,
  type ToolExecutionMiddleware,
} from "@innocenceharness/harness-tools";
import type { Delta, Provider } from "@innocenceharness/harness-providers";
import type { HarnessEvent, Message } from "@innocenceharness/harness-session";
import { BUILTIN_PRESETS, SubagentPlugin, createTaskTool, SUBAGENT_THREAD_NOTES, withThreadNotes } from "../src";
import type { SubagentOptions } from "@innocenceharness/harness-agent";
import { adaptedPresets } from "@innocenceharness/agent-presets";

// The preset-driven Task tool replaces the former hard-coded taskTool export.
const taskTool = createTaskTool(BUILTIN_PRESETS);
// Stable marker phrase from the built-in explore persona: distinguishes the
// child session's system prompt from the parent's in the dual provider below.
const EXPLORE_MARKER = "Read-Only Codebase Explorer";

describe("Task tool via session spawner", () => {
  it("spawns a child session that runs tools and reports back to the parent", async () => {
    let childPeeked = 0;
    let parentTurn = 0;
    let childTurn = 0;
    let childSystem = "";

    // One provider for both sessions; the child's explore system prompt
    // distinguishes whose conversation each request belongs to.
    const provider: Provider = {
      id: "dual",
      async *chat(req): AsyncIterable<Delta> {
        const isChild = req.system.includes(EXPLORE_MARKER);
        if (isChild) {
          childSystem = req.system;
          childTurn += 1;
          if (childTurn === 1) {
            yield { type: "toolCall", id: "c1", toolName: "Peek", args: {} };
          } else {
            yield { type: "text", text: "子代理报告：找到了" };
          }
        } else {
          parentTurn += 1;
          if (parentTurn === 1) {
            yield {
              type: "toolCall",
              id: "p1",
              toolName: "Task",
              args: { agentType: "explore", prompt: "查一下" },
            };
          } else {
            yield { type: "text", text: "父级最终答案" };
          }
        }
      },
    };
    const peekTool: Tool = {
      name: "Peek",
      description: "peek",
      readOnly: true,
      sideEffect: "none",
      parameters: { type: "object" },
      permissionResource: () => ({ action: "read", kind: "test", scope: "peek" }),
      persistArgs: (args) => ({ ...args }),
      execute: async () => {
        childPeeked += 1;
        return { content: "peek-result" };
      },
    };

    const session = await createTestSession({
      plugins: [
        {
          name: "wire",
          activate(ctx) {
            ctx.registerTool(peekTool);
          },
        },
        SubagentPlugin,
      ],
      provider,
      workspaceRoot: "D:/tmp",
      permission: { mode: "auto", decider: { ask: async () => "deny" } },
    });

    const events: HarnessEvent[] = [];
    session.on((e) => events.push(e));
    const result = await session.run("帮我查");

    expect(result.finalText).toBe("父级最终答案");
    expect(childPeeked).toBe(1);
    // M3 全栈锚定：线程注记真实到达子会话的 provider 系统提示词
    // （Task → spawner → 子会话 → buildSystemPrompt 全路径）。
    expect(childSystem).toContain("Thread notes:");
    expect(childSystem).toContain("never a bare filename");
    // The child report became the Task tool result inside the parent history.
    const taskResult = session.history
      .flatMap((m) => m.parts)
      .find((p) => p.type === "toolResult" && p.content.includes("子代理报告"));
    expect(taskResult).toBeDefined();
    // Child tool activity never leaked token-level noise into the parent text.
    expect(result.finalText).not.toContain("peek-result");
  });

  it("forwards the task description to the spawner without changing the tool result", async () => {
    const run = vi.fn(async () => ({ finalText: "子会话结论", turns: 1 }));

    const result = await taskTool.execute(
      { agentType: "explore", description: "检查生命周期", prompt: "执行检查" },
      {
        workspaceRoot: "D:/tmp",
        signal: new AbortController().signal,
        log: () => {},
        scope: createExecutionScope("Task"),
        subagent: { run },
      },
    );

    expect(run).toHaveBeenCalledWith(expect.objectContaining({ description: "检查生命周期" }));
    expect(result).toEqual({ content: "【检查生命周期】\n子会话结论" });
  });

  it("appends the [run:...] marker when the spawner reports the started childId", async () => {
    const run = vi.fn(async (options: SubagentOptions) => {
      options.onLifecycle?.({ childId: "child_abc", parentSessionId: "s", description: "", status: "started" });
      return { finalText: "结论", turns: 1 };
    });

    const result = await taskTool.execute(
      { agentType: "explore", prompt: "查" },
      {
        workspaceRoot: "D:/tmp",
        signal: new AbortController().signal,
        log: () => {},
        scope: createExecutionScope("Task"),
        subagent: { run },
      },
    );
    expect(result.content).toBe("结论\n\n[run:child_abc]");
  });

  it("resume forwards to the spawner and stamps the reopened run id from the lifecycle event", async () => {
    const resume = vi.fn(
      async (input: {
        runId: string;
        prompt: string;
        onLifecycle?: (event: { childId: string; status: string; resumed?: true }) => void;
      }) => {
        input.onLifecycle?.({ childId: "child_real", status: "running", resumed: true });
        return { finalText: "续跑结论", turns: 2 };
      },
    );

    const result = await taskTool.execute(
      { resume: "child_old", prompt: "继续执行" },
      {
        workspaceRoot: "D:/tmp",
        signal: new AbortController().signal,
        log: () => {},
        scope: createExecutionScope("Task"),
        subagent: {
          run: async () => ({ finalText: "x", turns: 1 }),
          resume,
        },
      },
    );

    expect(resume).toHaveBeenCalledWith(expect.objectContaining({ runId: "child_old", prompt: "继续执行" }));
    // 运行标识以重开事件回流的 childId 为准（续跑链可再续）。
    expect(result.content).toBe("续跑结论\n\n[run:child_real]");
    expect(result.isError).toBeUndefined();
  });

  it("resume failures surface as an error result carrying the authored message", async () => {
    const result = await taskTool.execute(
      { resume: "child_gone", prompt: "继续" },
      {
        workspaceRoot: "D:/tmp",
        signal: new AbortController().signal,
        log: () => {},
        scope: createExecutionScope("Task"),
        subagent: {
          run: async () => ({ finalText: "x", turns: 1 }),
          resume: async () => {
            throw new Error("子代理不可续跑：child_gone（未知、未完成或已释放）");
          },
        },
      },
    );
    expect(result.isError).toBe(true);
    expect(result.content).toContain("不可续跑");
    expect(result.content).toContain("child_gone");
  });

  it("resume without a resumable host spawner reports an error result", async () => {
    const result = await taskTool.execute(
      { resume: "child_x", prompt: "继续" },
      {
        workspaceRoot: "D:/tmp",
        signal: new AbortController().signal,
        log: () => {},
        scope: createExecutionScope("Task"),
        subagent: { run: async () => ({ finalText: "x", turns: 1 }) },
      },
    );
    expect(result.isError).toBe(true);
    expect(result.content).toContain("不支持续跑");
  });
  it("marks a child model failure as an error tool result instead of success", async () => {
    const run = vi.fn(async () => ({
      finalText: "子会话部分输出",
      turns: 1,
      completion: { finishReason: "error" as const, aborted: false },
    }));

    const result = await taskTool.execute(
      { agentType: "explore", prompt: "执行检查" },
      {
        workspaceRoot: "D:/tmp",
        signal: new AbortController().signal,
        log: () => {},
        scope: createExecutionScope("Task"),
        subagent: { run },
      },
    );

    expect(result).toMatchObject({ isError: true });
    expect(result.content).toContain("子会话部分输出");
  });
  it("reports an error result when the host provides no spawner", async () => {
    const r = await taskTool.execute(
      { agentType: "explore", prompt: "查" },
      {
        workspaceRoot: "D:/tmp",
        signal: new AbortController().signal,
        log: () => {},
        scope: createExecutionScope("Task"),
        // no subagent
      },
    );
    expect(r.isError).toBe(true);
    expect(r.content).toContain("不支持子代理");
  });


  it("child sessions inherit processors, middleware and the parent run scope", async () => {
    let childPeeked = 0;
    let parentTurn = 0;
    let childTurn = 0;
    let childUser: Message | undefined;
    let taskScope: ExecutionScope | undefined;
    let peekScope: ExecutionScope | undefined;

    const provider: Provider = {
      id: "dual",
      async *chat(req): AsyncIterable<Delta> {
        const isChild = req.system.includes(EXPLORE_MARKER);
        if (isChild) {
          childTurn += 1;
          if (childTurn === 1) {
            childUser = req.messages[0];
            yield { type: "toolCall", id: "c1", toolName: "Peek", args: {} };
          } else {
            yield { type: "text", text: "子代理报告：找到了" };
          }
        } else {
          parentTurn += 1;
          if (parentTurn === 1) {
            yield {
              type: "toolCall",
              id: "p1",
              toolName: "Task",
              args: { agentType: "explore", prompt: "查一下" },
            };
          } else {
            yield { type: "text", text: "父级最终答案" };
          }
        }
      },
    };
    const peekTool: Tool = {
      name: "Peek",
      description: "peek",
      readOnly: true,
      sideEffect: "none",
      parameters: { type: "object" },
      permissionResource: () => ({ action: "read", kind: "test", scope: "peek" }),
      persistArgs: (args) => ({ ...args }),
      execute: async () => {
        childPeeked += 1;
        return { content: "peek-result" };
      },
    };

    const session = await createTestSession({
      plugins: [
        {
          name: "wire",
          activate(ctx) {
            ctx.registerTool(peekTool);
            ctx.registerMessageProcessor({
              name: "mark",
              order: 0,
              async process(message) {
                return { ...message, parts: [...message.parts, { type: "text", text: " [marked]" }] };
              },
            });
          },
        },
        SubagentPlugin,
      ],
      provider,
      workspaceRoot: "D:/tmp",
      permission: { mode: "auto", decider: { ask: async () => "deny" } },
    });
    const recorder: ToolExecutionMiddleware = {
      name: "scope-recorder",
      async execute(invocation, next) {
        if (invocation.toolName === "Task") taskScope = invocation.scope;
        else peekScope = invocation.scope;
        return next();
      },
    };
    session.registry.createContext("scope-recorder", () => {}).registerToolMiddleware(recorder);

    const result = await session.run("帮我查", undefined, { taskId: "task-42" });

    expect(result.finalText).toBe("父级最终答案");
    expect(childPeeked).toBe(1);
    // Middleware inheritance: the child's Peek call ran through the same
    // middleware object registered on the parent registry.
    expect(taskScope).toBeDefined();
    expect(peekScope).toBeDefined();
    expect(taskScope!.invocationId).toMatch(/^inv-/);
    // Scope inheritance: sessionId/taskId/routeId match the parent Task call.
    expect(peekScope!.sessionId).toBe(taskScope!.sessionId);
    expect(peekScope!.sessionId).toMatch(/^sess-/);
    expect(peekScope!.routeId).toBe(taskScope!.routeId);
    expect(peekScope!.routeId).toMatch(/^route-/);
    expect(peekScope!.taskId).toBe("task-42");
    expect(peekScope!.parentInvocationId).toBe(taskScope!.invocationId);
    expect(peekScope!.invocationId).not.toBe(taskScope!.invocationId);
    // Processor inheritance: the child's prompt went through the parent's
    // processor before entering the child loop.
    expect(childUser?.parts.at(-1)).toMatchObject({ type: "text", text: " [marked]" });
  });

  it("parks the completed child session for resume; session teardown releases it", async () => {
    let parentTurn = 0;
    const provider: Provider = {
      id: "dual",
      async *chat(req): AsyncIterable<Delta> {
        if (req.system.includes(EXPLORE_MARKER)) {
          yield { type: "text", text: "子代理报告" };
        } else {
          parentTurn += 1;
          if (parentTurn === 1) {
            yield { type: "toolCall", id: "p1", toolName: "Task", args: { agentType: "explore", prompt: "查一下" } };
          } else {
            yield { type: "text", text: "父级最终答案" };
          }
        }
      },
    };
    const session = await createTestSession({
      plugins: [SubagentPlugin],
      provider,
      workspaceRoot: "D:/tmp",
      permission: { mode: "auto", decider: { ask: async () => "deny" } },
    });
    const disposeSpy = vi.spyOn(AgentSession.prototype, "dispose");
    try {
      const result = await session.run("帮我查");
      expect(result.finalText).toBe("父级最终答案");
      // 完成 = 驻留待续跑（不即时 dispose）。
      expect(disposeSpy).toHaveBeenCalledTimes(0);
      await session.dispose();
      // 会话收尾释放驻留子会话；父会话自身的 dispose 也计一次。
      expect(disposeSpy).toHaveBeenCalledTimes(2);
    } finally {
      disposeSpy.mockRestore();
    }
  });

  it("end to end: resume continues the parked child session's own conversation", async () => {
    let childTurn = 0;
    const childRequests: Array<Array<{ role: string; parts: Array<{ type: string; text?: string }> }>> = [];
    const provider: Provider = {
      id: "dual",
      async *chat(req): AsyncIterable<Delta> {
        if (req.system.includes(EXPLORE_MARKER)) {
          // 推快照（活引用会让两份记录在断言时长成同一终态）。
          childRequests.push(req.messages.map((m) => ({ role: m.role, parts: [...m.parts] })) as never);
          childTurn += 1;
          yield { type: "text", text: childTurn === 1 ? "首段结论" : "续段结论" };
          return;
        }
        yield { type: "text", text: "父级不参与" };
      },
    };
    const session = await createTestSession({
      plugins: [SubagentPlugin],
      provider,
      workspaceRoot: "D:/tmp",
      permission: { mode: "auto", decider: { ask: async () => "deny" } },
    });

    // 直接驱动会话级 spawner：首跑完成即驻留，runId 从生命周期建档事件捕获。
    let childId: string | undefined;
    const first = await session.spawner.run({
      systemPrompt: "You are the Read-Only Codebase Explorer of the harness.",
      tools: "readOnly",
      prompt: "查一下",
      onLifecycle: (event) => {
        if (event.status === "started") childId = event.childId;
      },
    });
    expect(first.finalText).toBe("首段结论");
    expect(childId).toBeDefined();

    const second = await session.spawner.resume!({ runId: childId!, prompt: "继续查" });
    expect(second.finalText).toBe("续段结论");
    // 同一子会话：第二次请求带着首段对话（历史增长，含首段 prompt 与结论）。
    expect(childRequests).toHaveLength(2);
    expect(childRequests[1]!.length).toBeGreaterThan(childRequests[0]!.length);
    const firstTexts = childRequests[0]!.flatMap((m) => m.parts.map((p) => p.text ?? "")).join("");
    expect(firstTexts).toContain("查一下");
    const secondTexts = childRequests[1]!.flatMap((m) => m.parts.map((p) => p.text ?? "")).join("");
    expect(secondTexts).toContain("首段结论");
    expect(secondTexts).toContain("继续查");
  });

  it("disposes the child session even when the spawn fails", async () => {
    let parentTurn = 0;
    const provider: Provider = {
      id: "dual",
      async *chat(req): AsyncIterable<Delta> {
        if (req.system.includes(EXPLORE_MARKER)) {
          yield { type: "text", text: "不应到达" };
        } else {
          parentTurn += 1;
          if (parentTurn === 1) {
            yield { type: "toolCall", id: "p1", toolName: "Task", args: { agentType: "explore", prompt: "poison 查一下" } };
          } else {
            yield { type: "text", text: "父级收到错误" };
          }
        }
      },
    };
    const session = await createTestSession({
      plugins: [
        SubagentPlugin,
        {
          name: "wire",
          activate(ctx) {
            ctx.registerMessageProcessor({
              name: "poison-guard",
              order: 0,
              async process(message) {
                if (message.parts.some((p) => p.type === "text" && p.text.includes("poison"))) {
                  throw new Error("poison input rejected");
                }
                return message;
              },
            });
          },
        },
      ],
      provider,
      workspaceRoot: "D:/tmp",
      permission: { mode: "auto", decider: { ask: async () => "deny" } },
    });
    const disposeSpy = vi.spyOn(AgentSession.prototype, "dispose");
    try {
      const result = await session.run("开始");
      expect(result.finalText).toBe("父级收到错误");
      const taskResult = session.history
        .flatMap((m) => m.parts)
        .find((p) => p.type === "toolResult");
      expect(taskResult).toMatchObject({ isError: true });
      expect(JSON.stringify(taskResult)).toContain("工具执行出错");
      expect(JSON.stringify(taskResult)).not.toContain("poison input rejected");
      expect(disposeSpy).toHaveBeenCalledTimes(1); // disposed on the failure path
    } finally {
      disposeSpy.mockRestore();
    }
  });
});

describe("taskTool persistence policy", () => {
  const SECRET = "TASK-PLUGIN-SECRET-3f9c";

  it("persists the agent type and the full prompt/description originals", () => {
    const persisted = taskTool.persistArgs({
      agentType: "general",
      description: `任务：处理 ${SECRET}`,
      prompt: `use ${SECRET}`,
    });
    expect(persisted).toEqual({
      agentType: "general",
      prompt: `use ${SECRET}`,
      description: `任务：处理 ${SECRET}`,
    });
  });

  it("persists resume verbatim (agentType is a spawn-time choice, not a resume field)", () => {
    expect(taskTool.persistArgs({ resume: `run-${SECRET}`, prompt: "继续" })).toEqual({
      resume: `run-${SECRET}`,
      prompt: "继续",
    });
  });

  it("validateArgs requires a non-empty prompt", async () => {
    await expect(taskTool.validateArgs?.({ agentType: "explore", prompt: " " })).rejects.toThrow(
      "prompt",
    );
  });

  it("validateArgs: resume exempts agentType but must itself be a non-empty id", async () => {
    await expect(taskTool.validateArgs?.({ resume: "child_x", prompt: "继续" })).resolves.toBeUndefined();
    await expect(taskTool.validateArgs?.({ resume: " ", prompt: "继续" })).rejects.toThrow("resume");
    await expect(taskTool.validateArgs?.({ prompt: "没有类型" })).rejects.toThrow("agentType");
  });

  it("resources key on the agent type; resume keys on the resume scope", () => {
    const resource = taskTool.permissionResource(
      { agentType: "explore", prompt: SECRET },
      {
        workspaceRoot: "D:/tmp",
        signal: new AbortController().signal,
        log: () => {},
        scope: createExecutionScope("Task"),
      },
    );
    expect(resource).toEqual({ action: "spawn", kind: "agent", scope: "explore" });
    const resumed = taskTool.permissionResource(
      { resume: "child_x", prompt: "继续" },
      {
        workspaceRoot: "D:/tmp",
        signal: new AbortController().signal,
        log: () => {},
        scope: createExecutionScope("Task"),
      },
    );
    expect(resumed).toEqual({ action: "spawn", kind: "agent", scope: "resume" });
  });
});

describe("thread notes (M3)", () => {  const fakeCtx = (run: unknown) => ({
    workspaceRoot: "D:/tmp",
    signal: new AbortController().signal,
    log: () => {},
    scope: createExecutionScope("Task"),
    subagent: { run },
  });

  it("appends the thread-notes block after the persona for every catalog preset", async () => {
    // 与默认插件同一合并语义：内建 + 适配预设按 id 去重（extra 覆盖），
    // "每个子代理线程都带注记"是默认目录的属性而非两预设切片。
    const catalog = [...new Map([...BUILTIN_PRESETS, ...adaptedPresets].map((p) => [p.id, p])).values()];
    const catalogTool = createTaskTool(catalog);
    const run = vi.fn(async (_options: { systemPrompt: string }) => ({ finalText: "done", turns: 1 }));
    for (const preset of catalog) {
      await catalogTool.execute({ agentType: preset.id, prompt: "做" }, fakeCtx(run) as never);
    }
    expect(run).toHaveBeenCalledTimes(catalog.length);
    expect(catalog.length).toBeGreaterThanOrEqual(8);
    for (const call of run.mock.calls) {
      const systemPrompt = call[0]?.systemPrompt ?? "";
      const personaAt = systemPrompt.indexOf("You are");
      const notesAt = systemPrompt.indexOf("Thread notes:");
      expect(personaAt).toBeGreaterThanOrEqual(0);
      expect(notesAt).toBeGreaterThan(personaAt);
    }
  });

  it("carries the subagent-specific disciplines: root-resolved paths, load-bearing quotes only, no report files", () => {
    expect(SUBAGENT_THREAD_NOTES).toContain("workspace root");
    expect(SUBAGENT_THREAD_NOTES).toContain("load-bearing");
    // 禁写报告文件语义：父级只读最终消息文本，不读子代理创建的文件。
    expect(SUBAGENT_THREAD_NOTES).toContain("report");
    expect(SUBAGENT_THREAD_NOTES).toContain("final message text");
    // 子代理不继承共享文风片段：朴素文风（无 emoji、工具调用前用句号）在线程注记补位。
    expect(SUBAGENT_THREAD_NOTES).toContain("no emojis");
    expect(SUBAGENT_THREAD_NOTES).toContain("period");
  });

  it("withThreadNotes keeps the persona intact and separates the block", () => {
    const persona = "PERSONA-BODY";
    const combined = withThreadNotes(persona);
    expect(combined.startsWith(persona)).toBe(true);
    expect(combined).toContain("\n\nThread notes:\n");
  });
});

describe("context inheritance (S2b)", () => {
  const fakeCtx = (run: unknown) => ({
    workspaceRoot: "D:/tmp",
    signal: new AbortController().signal,
    log: () => {},
    scope: createExecutionScope("Task"),
    subagent: { run },
  });

  it("forwards the inheritContext flag into the spawner run input", async () => {
    const run = vi.fn(async () => ({ finalText: "done", turns: 1 }));
    await taskTool.execute(
      { agentType: "explore", prompt: "延续父任务", inheritContext: true },
      fakeCtx(run) as never,
    );
    expect(run).toHaveBeenCalledWith(expect.objectContaining({ inheritContext: true }));
    const withoutFlag = vi.fn(async (_options: unknown) => ({ finalText: "done", turns: 1 }));
    await taskTool.execute(
      { agentType: "explore", prompt: "全新任务" },
      fakeCtx(withoutFlag) as never,
    );
    expect(withoutFlag.mock.calls[0]?.[0]).not.toHaveProperty("inheritContext");
  });

  it("persists the inheritContext boolean alongside the prompt original", () => {
    expect(taskTool.persistArgs({ agentType: "explore", prompt: "x", inheritContext: true })).toEqual({
      agentType: "explore",
      prompt: "x",
      inheritContext: true,
    });
    expect(
      taskTool.persistArgs({ agentType: "explore", prompt: "x", inheritContext: "junk" }),
    ).not.toHaveProperty("inheritContext");
  });

  it("end to end: the child session's first request carries seeded history and the briefing", async () => {
    let parentTurn = 0;
    const childRequests: Array<{ system: string; messages: unknown[] }> = [];
    const provider: Provider = {
      id: "dual",
      async *chat(req): AsyncIterable<Delta> {
        const isChild = req.system.includes(EXPLORE_MARKER);
        if (isChild) {
          childRequests.push({ system: req.system, messages: [...req.messages] });
          yield { type: "text", text: "子代理延续结论" };
          return;
        }
        parentTurn += 1;
        if (parentTurn === 1) {
          yield { type: "text", text: "父级先说一句背景" };
        } else if (parentTurn === 2) {
          yield {
            type: "toolCall",
            id: "p1",
            toolName: "Task",
            args: { agentType: "explore", prompt: "延续下去", inheritContext: true },
          };
        } else {
          yield { type: "text", text: "父级最终答案" };
        }
      },
    };
    const session = await createTestSession({
      plugins: [SubagentPlugin],
      provider,
      workspaceRoot: "D:/tmp",
      permission: { mode: "auto", decider: { ask: async () => "deny" } },
    });
    await session.run("第一轮：建立上下文");
    const result = await session.run("第二轮：派生继承子代理");
    expect(result.finalText).toBe("父级最终答案");
    expect(childRequests).toHaveLength(1);
    const messages = childRequests[0]!.messages as Array<{
      role: string;
      parts: Array<{ type: string; text?: string }>;
    }>;
    // 种子历史先于简报+任务 prompt：首条是父会话早前轮次，末条含继承简报。
    expect(messages[0]!.parts[0]!.text).toContain("第一轮");
    const lastText = messages[messages.length - 1]!.parts
      .filter((p) => p.type === "text")
      .map((p) => p.text)
      .join("");
    expect(lastText).toContain("[Inherited context]");
    expect(lastText).toContain("延续下去");
    expect(childRequests[0]!.system).toContain("Thread notes:");
  });
});

/** Mounts the plugin on a bare kernel context (tools spine service only). */
async function mountSubagent(): Promise<Context> {
  const ctx = new Context();
  await ctx.plugin(ToolsPlugin);
  await ctx.plugin(SubagentPlugin);
  return ctx;
}

describe("SubagentPlugin", () => {
  it("registers the Task tool with sane metadata", async () => {
    const ctx = await mountSubagent();
    expect(ctx.tools.get("Task")).toBeDefined();
    expect(ctx.tools.get("Task")!.readOnly).toBe(false);
    // The child session audits its own tool effects — the parent must not
    // double-count them (P1 plugin-task keys on this value).
    expect(ctx.tools.get("Task")).toMatchObject({ sideEffect: "delegated" });
  });
});
