// Persistence-SPI end-to-end safety net (moved here with the loop when the
// retired core package was deleted; imports re-pointed to the owning spine
// packages). Proves raw tool args reach execute, that persisted surfaces
// (history/events/requests/audit/transcript) carry the persistArgs shape with
// full original values (no redaction — owner decision for this open-source
// local app), that persistArgs runs exactly once per invocation, and that
// preparation failures surface the tool-authored diagnostic while the call
// record keeps empty args and never executes.
import { describe, expect, it } from "vitest";
import { convertArrayToReadableStream, MockLanguageModelV3 } from "ai/test";
import { Context } from "@innocenceharness/kernel";
import {
  ToolsPlugin,
  type Tool,
} from "@innocenceharness/harness-tools";
import {
  PermissionEngine,
  type PermissionAuditEntry,
  type PermissionRequest,
} from "@innocenceharness/harness-permissions";
import type { Delta, Provider, ProviderModel } from "@innocenceharness/harness-providers";
import { textMessage, toTranscript, type HarnessEvent, type Message } from "@innocenceharness/harness-session";
import { runLoop } from "../src";

type MockStreamPart = Awaited<ReturnType<MockLanguageModelV3["doStream"]>>["stream"] extends ReadableStream<infer Part>
  ? Part
  : never;

function sdkProviderForCalls(calls: Array<{ toolName: string; args: Record<string, unknown> }>): Provider & { model: ProviderModel } {
  let turn = 0;
  const model = new MockLanguageModelV3({
    provider: "sdk-test",
    modelId: "sdk-model",
    async doStream() {
      turn += 1;
      const events: MockStreamPart[] = turn === 1
        ? [
            { type: "stream-start", warnings: [] },
            ...calls.map((call, index) => ({
              type: "tool-call" as const,
              toolCallId: `sdk-call-${index}`,
              toolName: call.toolName,
              input: JSON.stringify(call.args),
            })),
            {
              type: "finish",
              usage: {
                inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
                outputTokens: { total: 1, text: 1, reasoning: 0 },
              },
              finishReason: { unified: "tool-calls", raw: "tool_calls" },
            },
          ]
        : [
            { type: "stream-start", warnings: [] },
            { type: "text-start", id: "done" },
            { type: "text-delta", id: "done", delta: "all done" },
            {
              type: "finish",
              usage: {
                inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
                outputTokens: { total: 1, text: 1, reasoning: 0 },
              },
              finishReason: { unified: "stop", raw: "stop" },
            },
          ];
      return { stream: convertArrayToReadableStream(events) };
    },
  });
  return {
    id: "sdk-test",
    model: { value: model, providerId: "sdk-test", modelId: "sdk-model" },
    async *chat(): AsyncIterable<Delta> {
      throw new Error("legacy provider path must not run");
    },
  };
}

/**
 * One unique secret per tool family. Each fake tool receives its secret in
 * raw execution args; the assertions below prove the secret reaches execute
 * and reaches NOTHING else (history, events, permission requests, audit,
 * transcript, resources).
 */
const SECRETS = {
  write: "WRITE-SECRET-9f1ac3",
  edit: "EDIT-SECRET-7c2bd1",
  bash: "BASH-SECRET-5d3ee7",
  mcp: "MCP-SECRET-3e8f22",
  task: "TASK-SECRET-1a9c55",
  browser: "browser-secret-0b7d44",
} as const;

const ALL_SECRETS = Object.values(SECRETS);

/** Write-style: path + full content. Persisted: path, bounded body, length and summary. */
function writeStyleTool(): Tool & { raw: Array<Record<string, unknown>> } {
  const raw: Array<Record<string, unknown>> = [];
  return {
    name: "Write",
    description: "write",
    readOnly: false,
    sideEffect: "paths",
    parameters: { type: "object" },
    async validateArgs(args) {
      if (typeof args.path !== "string" || typeof args.content !== "string") {
        throw new Error("Write 需要 path 与 content");
      }
    },
    permissionResource: (args) => ({
      action: "write",
      kind: "path",
      scope: String(args.path),
    }),
    persistArgs: (args) => ({
      path: String(args.path),
      content: String(args.content),
      contentLength: String(args.content).length,
      summary: String(args.content),
    }),
    raw,
    async execute(args) {
      raw.push(args);
      return { content: "written" };
    },
  };
}

/** Edit-style: old/new strings are persisted for chat diff display. */
function editStyleTool(): Tool & { raw: Array<Record<string, unknown>> } {
  const raw: Array<Record<string, unknown>> = [];
  return {
    name: "Edit",
    description: "edit",
    readOnly: false,
    sideEffect: "paths",
    parameters: { type: "object" },
    permissionResource: (args) => ({
      action: "write",
      kind: "path",
      scope: String(args.path),
    }),
    persistArgs: (args) => ({
      path: String(args.path),
      old_string: String(args.old_string),
      new_string: String(args.new_string),
      contentLength: String(args.new_string).length,
      summary: String(args.new_string),
    }),
    raw,
    async execute(args) {
      raw.push(args);
      return { content: "edited" };
    },
  };
}

/** Bash-style: the full command persists verbatim. */
function bashStyleTool(): Tool & { raw: Array<Record<string, unknown>> } {
  const raw: Array<Record<string, unknown>> = [];
  return {
    name: "Bash",
    description: "bash",
    readOnly: false,
    sideEffect: "process",
    parameters: { type: "object" },
    permissionResource: (args) => ({
      action: "execute",
      kind: "command",
      scope: String(args.command),
    }),
    persistArgs: (args) => ({ command: String(args.command) }),
    raw,
    async execute(args) {
      raw.push(args);
      return { content: "ran" };
    },
  };
}

/** MCP-style: server/tool plus the full argument copy. */
function mcpStyleTool(): Tool & { raw: Array<Record<string, unknown>> } {
  const raw: Array<Record<string, unknown>> = [];
  return {
    name: "mcp__ci__deploy",
    description: "mcp",
    readOnly: false,
    sideEffect: "unknown",
    parameters: { type: "object" },
    permissionResource: () => ({
      action: "call",
      kind: "mcp",
      scope: "ci/deploy",
    }),
    persistArgs: (args) => ({
      server: "ci",
      tool: "deploy",
      args: { ...args },
    }),
    raw,
    async execute(args) {
      raw.push(args);
      return { content: "deployed" };
    },
  };
}

/** Task-style: agent type + full prompt. */
function taskStyleTool(): Tool & { raw: Array<Record<string, unknown>> } {
  const raw: Array<Record<string, unknown>> = [];
  return {
    name: "Task",
    description: "task",
    readOnly: false,
    sideEffect: "unknown",
    parameters: { type: "object" },
    permissionResource: (args) => ({
      action: "spawn",
      kind: "agent",
      scope: String(args.agentType ?? "explore"),
    }),
    persistArgs: (args) => ({
      agentType: String(args.agentType ?? "explore"),
      prompt: String(args.prompt ?? ""),
    }),
    raw,
    async execute(args) {
      raw.push(args);
      return { content: "tasked" };
    },
  };
}

/** Browser-style: the full URL persists verbatim. */
function browserStyleTool(): Tool & { raw: Array<Record<string, unknown>> } {
  const raw: Array<Record<string, unknown>> = [];
  return {
    name: "BrowserNavigate",
    description: "navigate",
    readOnly: false,
    sideEffect: "network",
    parameters: { type: "object" },
    permissionResource: (args) => ({
      action: "navigate",
      kind: "url",
      scope: String(args.url),
    }),
    persistArgs: (args) => ({
      url: String(args.url),
    }),
    raw,
    async execute(args) {
      raw.push(args);
      return { content: "navigated" };
    },
  };
}

interface RunCapture {
  history: Message[];
  events: HarnessEvent[];
  audit: PermissionAuditEntry[];
  requests: PermissionRequest[];
  raws: Record<string, Array<Record<string, unknown>>>;
  persistCalls: Record<string, number>;
}

/** Runs one scripted turn that invokes every fake tool once. */
async function runWithAllTools(providerOverride?: Provider): Promise<RunCapture> {
  const tools = {
    Write: writeStyleTool(),
    Edit: editStyleTool(),
    Bash: bashStyleTool(),
    "mcp__ci__deploy": mcpStyleTool(),
    Task: taskStyleTool(),
    BrowserNavigate: browserStyleTool(),
  };
  const persistCalls: Record<string, number> = {};
  for (const tool of Object.values(tools)) {
    const inner = tool.persistArgs.bind(tool);
    tool.persistArgs = (args) => {
      persistCalls[tool.name] = (persistCalls[tool.name] ?? 0) + 1;
      return inner(args);
    };
  }

  const calls: Array<{ toolName: string; args: Record<string, unknown> }> = [
    { toolName: "Write", args: { path: "notes.txt", content: `token=${SECRETS.write}` } },
    {
      toolName: "Edit",
      args: { path: "notes.txt", old_string: `old ${SECRETS.edit}`, new_string: `new ${SECRETS.edit}` },
    },
    { toolName: "Bash", args: { command: `deploy --token=${SECRETS.bash}` } },
    { toolName: "mcp__ci__deploy", args: { apiKey: SECRETS.mcp } },
    { toolName: "Task", args: { agentType: "general", prompt: `use ${SECRETS.task}` } },
    {
      toolName: "BrowserNavigate",
      args: { url: `https://user:${SECRETS.browser}@example.com/path?q=1#frag` },
    },
  ];

  let turn = 0;
  const provider: Provider = providerOverride ?? {
    id: "scripted",
    async *chat(): AsyncIterable<Delta> {
      turn += 1;
      if (turn === 1) {
        for (const [n, call] of calls.entries()) {
          yield { type: "toolCall", id: `c${n}`, toolName: call.toolName, args: call.args };
        }
      } else {
        yield { type: "text", text: "all done" };
      }
    },
  };

  const kernel = new Context();
  await kernel.plugin(ToolsPlugin);
  for (const tool of Object.values(tools)) {
    // Route through the tools service so the SPI gate is exercised too.
    kernel.tools.register(tool);
  }

  const events: HarnessEvent[] = [];
  const audit: PermissionAuditEntry[] = [];
  const requests: PermissionRequest[] = [];
  const history: Message[] = [];
  await runLoop(history, textMessage("user", "run everything"), {
    provider,
    tools: kernel.tools,
    permission: new PermissionEngine({
      mode: "ask",
      decider: {
        ask: async (req) => {
          requests.push(req);
          return "allow";
        },
      },
      audit: (entry) => audit.push(entry),
    }),
    systemPrompt: "s",
    workspaceRoot: "/tmp/ws",
    onEvent: (e) => events.push(e),
  });

  return {
    history,
    events,
    audit,
    requests,
    raws: Object.fromEntries(
      Object.entries(tools).map(([name, t]) => [name, (t as { raw: Array<Record<string, unknown>> }).raw]),
    ),
    persistCalls,
  };
}

describe("tool persisted args carry full originals (no redaction)", () => {
  it("execute receives raw SDK args; every persisted surface carries the full values", async () => {
    const calls: Array<{ toolName: string; args: Record<string, unknown> }> = [
      { toolName: "Write", args: { path: "notes.txt", content: `token=${SECRETS.write}` } },
      {
        toolName: "Edit",
        args: { path: "notes.txt", old_string: `old ${SECRETS.edit}`, new_string: `new ${SECRETS.edit}` },
      },
      { toolName: "Bash", args: { command: `deploy --token=${SECRETS.bash}` } },
      { toolName: "mcp__ci__deploy", args: { apiKey: SECRETS.mcp } },
      { toolName: "Task", args: { agentType: "general", prompt: `use ${SECRETS.task}` } },
      {
        toolName: "BrowserNavigate",
        args: { url: `https://user:${SECRETS.browser}@example.com/path?q=1#frag` },
      },
    ];
    const run = await runWithAllTools(sdkProviderForCalls(calls));

    expect(run.raws.Write[0].content).toBe(`token=${SECRETS.write}`);
    expect(run.raws.Edit[0].new_string).toBe(`new ${SECRETS.edit}`);
    expect(run.raws.Bash[0].command).toBe(`deploy --token=${SECRETS.bash}`);
    expect(run.raws["mcp__ci__deploy"][0].apiKey).toBe(SECRETS.mcp);
    expect(run.raws.Task[0].prompt).toBe(`use ${SECRETS.task}`);
    expect(run.raws.BrowserNavigate[0].url).toContain(SECRETS.browser);

    const surfaces: Array<[string, unknown]> = [
      ["history", run.history],
      ["events", run.events],
      ["permission requests", run.requests],
      ["audit", run.audit],
      ["transcript", toTranscript(run.history)],
    ];
    for (const secret of ALL_SECRETS) {
      for (const [name, surface] of surfaces) {
        expect(JSON.stringify(surface), `${name} must carry ${secret}`).toContain(secret);
      }
    }
  });

  it("execute receives raw args; persisted shapes carry the full originals", async () => {
    const run = await runWithAllTools();

    // Every tool executed exactly once, with the RAW values.
    expect(run.raws.Write[0].content).toBe(`token=${SECRETS.write}`);
    expect(run.raws.Edit[0].new_string).toBe(`new ${SECRETS.edit}`);
    expect(run.raws.Bash[0].command).toBe(`deploy --token=${SECRETS.bash}`);
    expect(run.raws["mcp__ci__deploy"][0].apiKey).toBe(SECRETS.mcp);
    expect(run.raws.Task[0].prompt).toBe(`use ${SECRETS.task}`);
    expect(run.raws.BrowserNavigate[0].url).toContain(SECRETS.browser);

    // History, events, permission requests, audit and transcript all carry the full values.
    const surfaces: Array<[string, unknown]> = [
      ["history", run.history],
      ["events", run.events],
      ["permission requests", run.requests],
      ["audit", run.audit],
      ["transcript", toTranscript(run.history)],
    ];
    for (const secret of ALL_SECRETS) {
      for (const [name, surface] of surfaces) {
        expect(JSON.stringify(surface), `${name} must carry ${secret}`).toContain(secret);
      }
    }

    // The persisted filesystem shapes carry text bodies for chat diff display.
    const writeCall = run.history
      .flatMap((m) => m.parts)
      .find((p) => p.type === "toolCall" && p.toolName === "Write");
    expect(writeCall && writeCall.type === "toolCall" && writeCall.args).toMatchObject({
      path: "notes.txt",
      content: `token=${SECRETS.write}`,
      contentLength: `token=${SECRETS.write}`.length,
      summary: `token=${SECRETS.write}`,
    });

    const editCall = run.history
      .flatMap((m) => m.parts)
      .find((p) => p.type === "toolCall" && p.toolName === "Edit");
    expect(editCall && editCall.type === "toolCall" && editCall.args).toMatchObject({
      path: "notes.txt",
      old_string: `old ${SECRETS.edit}`,
      new_string: `new ${SECRETS.edit}`,
      contentLength: `new ${SECRETS.edit}`.length,
      summary: `new ${SECRETS.edit}`,
    });

    const bashCall = run.history
      .flatMap((m) => m.parts)
      .find((p) => p.type === "toolCall" && p.toolName === "Bash");
    expect(bashCall && bashCall.type === "toolCall" && bashCall.args).toMatchObject({
      command: `deploy --token=${SECRETS.bash}`,
    });

    const mcpCall = run.history
      .flatMap((m) => m.parts)
      .find((p) => p.type === "toolCall" && p.toolName === "mcp__ci__deploy");
    expect(mcpCall && mcpCall.type === "toolCall" && mcpCall.args).toMatchObject({
      server: "ci",
      tool: "deploy",
      args: { apiKey: SECRETS.mcp },
    });

    const taskCall = run.history
      .flatMap((m) => m.parts)
      .find((p) => p.type === "toolCall" && p.toolName === "Task");
    expect(taskCall && taskCall.type === "toolCall" && taskCall.args).toMatchObject({
      agentType: "general",
      prompt: `use ${SECRETS.task}`,
    });

    const browserCall = run.history
      .flatMap((m) => m.parts)
      .find((p) => p.type === "toolCall" && p.toolName === "BrowserNavigate");
    expect(browserCall && browserCall.type === "toolCall" && browserCall.args).toMatchObject({
      url: `https://user:${SECRETS.browser}@example.com/path?q=1#frag`,
    });
  });

  it("permission requests and audit carry the full persisted resources and args", async () => {
    const run = await runWithAllTools();

    expect(run.requests.map((r) => `${r.toolName}:${r.resource.action}:${r.resource.kind}:${r.resource.scope}`))
      .toEqual([
        "Write:write:path:notes.txt",
        "Edit:write:path:notes.txt",
        `Bash:execute:command:deploy --token=${SECRETS.bash}`,
        "mcp__ci__deploy:call:mcp:ci/deploy",
        "Task:spawn:agent:general",
        `BrowserNavigate:navigate:url:https://user:${SECRETS.browser}@example.com/path?q=1#frag`,
      ]);
    expect(run.audit).toHaveLength(6);
    for (const entry of run.audit) {
      expect(entry.request.args).toBeDefined();
    }
  });

  it("persistArgs runs exactly once per invocation despite history/event/request/audit reuse", async () => {
    const run = await runWithAllTools();
    expect(run.persistCalls).toEqual({
      Write: 1,
      Edit: 1,
      Bash: 1,
      "mcp__ci__deploy": 1,
      Task: 1,
      BrowserNavigate: 1,
    });
  });

  it("a validateArgs failure becomes an error result; the tool never executes", async () => {
    const executed: Array<Record<string, unknown>> = [];
    const tool: Tool = {
      name: "Strict",
      description: "strict",
      readOnly: false,
      parameters: { type: "object" },
      async validateArgs(args) {
        if (typeof args.path !== "string") throw new Error("Strict 需要 path");
      },
      permissionResource: () => ({ action: "read", kind: "path", scope: "x" }),
      persistArgs: () => ({}),
      async execute(args) {
        executed.push(args);
        return { content: "never" };
      },
    };
    let turn = 0;
    const provider: Provider = {
      id: "scripted",
      async *chat(): AsyncIterable<Delta> {
        turn += 1;
        if (turn === 1) {
          yield { type: "toolCall", id: "c1", toolName: "Strict", args: { path: 42 } };
        } else {
          yield { type: "text", text: "handled" };
        }
      },
    };
    const kernel = new Context();
    await kernel.plugin(ToolsPlugin);
    kernel.tools.register(tool);
    const events: HarnessEvent[] = [];
    const history: Message[] = [];
    await runLoop(history, textMessage("user", "go"), {
      provider,
      tools: kernel.tools,
      permission: new PermissionEngine({ mode: "auto", decider: { ask: async () => "deny" } }),
      systemPrompt: "s",
      workspaceRoot: "/tmp/ws",
      onEvent: (e) => events.push(e),
    });

    expect(executed).toHaveLength(0);
    const result = history
      .flatMap((m) => m.parts)
      .find((p) => p.type === "toolResult") as { isError?: boolean; content: string };
    expect(result.isError).toBe(true);
    expect(result.content).toContain("工具调用准备失败");
  });

  it("raw args are not leaked when controlled execution throws", async () => {
    const secret = "EXEC-SECRET-7c20d8";
    const tool: Tool = {
      name: "Failing",
      description: "failing",
      readOnly: false,
      parameters: { type: "object" },
      permissionResource: () => ({ action: "write", kind: "test", scope: "failing" }),
      persistArgs: () => ({}),
      async execute(args) {
        throw new Error(`remote rejected ${String(args.password)}`);
      },
    };
    let turn = 0;
    const provider: Provider = {
      id: "scripted",
      async *chat(): AsyncIterable<Delta> {
        turn += 1;
        if (turn === 1) {
          yield { type: "toolCall", id: "c1", toolName: "Failing", args: { password: secret } };
        } else {
          yield { type: "text", text: "handled" };
        }
      },
    };
    const kernel = new Context();
    await kernel.plugin(ToolsPlugin);
    kernel.tools.register(tool);
    const events: HarnessEvent[] = [];
    const history: Message[] = [];
    await runLoop(history, textMessage("user", "go"), {
      provider,
      tools: kernel.tools,
      permission: new PermissionEngine({ mode: "auto", decider: { ask: async () => "deny" } }),
      systemPrompt: "s",
      workspaceRoot: "/tmp/ws",
      onEvent: (event) => events.push(event),
    });

    expect(JSON.stringify([history, events])).not.toContain(secret);
    const result = history
      .flatMap((message) => message.parts)
      .find((part) => part.type === "toolResult") as { isError?: boolean; content: string };
    expect(result).toMatchObject({ isError: true, content: "工具执行出错" });
  });

  it("a preparation failure surfaces the tool diagnostic; raw args stay wiped and the tool never runs", async () => {
    const executed: Array<Record<string, unknown>> = [];
    const tool: Tool = {
      name: "Broken",
      description: "broken",
      readOnly: false,
      parameters: { type: "object" },
      permissionResource: (args) => {
        if (typeof args.password !== "string") throw new Error("Broken 需要 password");
        // The tool contract: diagnostics name the failing argument, never
        // echo its content.
        throw new Error("resource check failed for password");
      },
      persistArgs: () => ({}),
      async execute(args) {
        executed.push(args);
        return { content: "never" };
      },
    };
    let turn = 0;
    const provider: Provider = {
      id: "scripted",
      async *chat(): AsyncIterable<Delta> {
        turn += 1;
        if (turn === 1) {
          yield { type: "toolCall", id: "c1", toolName: "Broken", args: { password: "PREP-SECRET-11" } };
        } else {
          yield { type: "text", text: "handled" };
        }
      },
    };
    const kernel = new Context();
    await kernel.plugin(ToolsPlugin);
    kernel.tools.register(tool);
    const history: Message[] = [];
    await runLoop(history, textMessage("user", "go"), {
      provider,
      tools: kernel.tools,
      permission: new PermissionEngine({ mode: "auto", decider: { ask: async () => "deny" } }),
      systemPrompt: "s",
      workspaceRoot: "/tmp/ws",
      onEvent: () => {},
    });

    expect(executed).toHaveLength(0);
    // The diagnostic flows so failures are diagnosable from the transcript.
    const result = history
      .flatMap((m) => m.parts)
      .find((p) => p.type === "toolResult") as { isError?: boolean; content: string };
    expect(result.isError).toBe(true);
    expect(result.content).toContain("工具调用准备失败");
    expect(result.content).toContain("resource check failed for password");
    // The call record keeps empty persisted args: the raw shape never enters
    // history even when the diagnostic does.
    const call = history
      .flatMap((m) => m.parts)
      .find((p) => p.type === "toolCall") as { args: Record<string, unknown> };
    expect(call.args).toEqual({});
    expect(JSON.stringify(history)).not.toContain("PREP-SECRET-11");
  });

  it("tool-returned images enter history and the model prompt; events stay lean", async () => {
    // "VISUALPAYLOAD11" 的 base64——SDK 校验图像数据必须是合法 base64。
    const images = [{ mediaType: "image/png", data: "VklTVUFMUEFZTE9BRDEx" }];
    const prompts: unknown[] = [];
    let turn = 0;
    const model = new MockLanguageModelV3({
      provider: "sdk-test",
      modelId: "sdk-model",
      async doStream(params) {
        turn += 1;
        prompts.push(params.prompt);
        const events: MockStreamPart[] = turn === 1
          ? [
              { type: "stream-start", warnings: [] },
              {
                type: "tool-call",
                toolCallId: "sdk-call-0",
                toolName: "Snap",
                input: JSON.stringify({}),
              },
              {
                type: "finish",
                usage: { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } },
                finishReason: { unified: "tool-calls", raw: "tool_calls" },
              },
            ]
          : [
              { type: "stream-start", warnings: [] },
              { type: "text-start", id: "done" },
              { type: "text-delta", id: "done", delta: "seen" },
              {
                type: "finish",
                usage: { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } },
                finishReason: { unified: "stop", raw: "stop" },
              },
            ];
        return { stream: convertArrayToReadableStream(events) };
      },
    });
    const provider: Provider & { model: ProviderModel } = {
      id: "sdk-test",
      model: { value: model, providerId: "sdk-test", modelId: "sdk-model" },
      async *chat(): AsyncIterable<Delta> {
        throw new Error("legacy provider path must not run");
      },
    };
    const snap: Tool = {
      name: "Snap",
      description: "snap",
      readOnly: true,
      parameters: { type: "object" },
      permissionResource: () => ({ action: "read", kind: "computer", scope: "screen" }),
      persistArgs: () => ({}),
      async execute() {
        return { content: "Screenshot saved (1280x720).", images };
      },
    };
    const kernel = new Context();
    await kernel.plugin(ToolsPlugin);
    kernel.tools.register(snap);
    const events: HarnessEvent[] = [];
    const history: Message[] = [];
    await runLoop(history, textMessage("user", "look"), {
      provider,
      tools: kernel.tools,
      permission: new PermissionEngine({ mode: "auto", decider: { ask: async () => "deny" } }),
      systemPrompt: "s",
      workspaceRoot: "/tmp/ws",
      onEvent: (e) => events.push(e),
    });

    // History carries the images for the provider mapping...
    const result = history
      .flatMap((m) => m.parts)
      .find((p) => p.type === "toolResult") as { images?: unknown };
    expect(result.images).toEqual(images);
    // ...the event surface stays lean (no base64 payloads to UI/IPC)...
    expect(JSON.stringify(events)).not.toContain("VklTVUFMUEFZTE9BRDEx");
    // ...and the follow-up model turn receives the image.
    expect(JSON.stringify(prompts[1])).toContain("VklTVUFMUEFZTE9BRDEx");
    expect(JSON.stringify(prompts[1])).toContain("image/png");
  });
});
