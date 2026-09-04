// End-to-end argument fidelity checks for the agent loop. Complete tool
// arguments must remain available to execution, history, events, permission
// requests, audit entries and transcripts. Preparation and execution failures
// must likewise retain their original diagnostics.
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

/** Distinct markers make accidental field omission easy to detect. */
const SECRETS = {
  write: "WRITE-SECRET-9f1ac3",
  edit: "EDIT-SECRET-7c2bd1",
  bash: "BASH-SECRET-5d3ee7",
  mcp: "MCP-SECRET-3e8f22",
  task: "TASK-SECRET-1a9c55",
  browser: "browser-secret-0b7d44",
} as const;

const ALL_SECRETS = Object.values(SECRETS);

/** Write-style: path + full content. */
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
    raw,
    async execute(args) {
      raw.push(args);
      return { content: "written" };
    },
  };
}

/** Edit-style: old/new strings remain available for chat diff display. */
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
    raw,
    async execute(args) {
      raw.push(args);
      return { content: "edited" };
    },
  };
}

/** Command-style: the full command remains verbatim. */
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
    raw,
    async execute(args) {
      raw.push(args);
      return { content: "ran" };
    },
  };
}

/** Remote-tool style: the full argument object remains available. */
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
    raw,
    async execute(args) {
      raw.push(args);
      return { content: "tasked" };
    },
  };
}

/** Navigation-style: the full URL remains verbatim. */
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
    raw,
    async execute(args) {
      raw.push(args);
      return { content: "navigated" };
    },
  };
}

interface RunCapture {
  calls: Array<{ toolName: string; args: Record<string, unknown> }>;
  history: Message[];
  events: HarnessEvent[];
  audit: PermissionAuditEntry[];
  requests: PermissionRequest[];
  raws: Record<string, Array<Record<string, unknown>>>;
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
    // Route through the tools service so registration is exercised too.
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
    calls,
    history,
    events,
    audit,
    requests,
    raws: Object.fromEntries(
      Object.entries(tools).map(([name, t]) => [name, (t as { raw: Array<Record<string, unknown>> }).raw]),
    ),
  };
}

function expectStructuredSurfacesToMatchCalls(run: RunCapture): void {
  const expected = run.calls;
  const historyCalls = run.history.flatMap((message) =>
    message.parts.flatMap((part) =>
      part.type === "toolCall" ? [{ toolName: part.toolName, args: part.args }] : [],
    ),
  );
  const eventCalls = run.events.flatMap((event) =>
    event.type === "toolCall"
      ? [{ toolName: event.call.toolName, args: event.call.args }]
      : [],
  );
  const permissionCalls = run.requests.map((request) => ({
    toolName: request.toolName,
    args: request.args,
  }));
  const auditCalls = run.audit.map(({ request }) => ({
    toolName: request.toolName,
    args: request.args,
  }));

  expect(historyCalls).toEqual(expected);
  expect(eventCalls).toEqual(expected);
  expect(permissionCalls).toEqual(expected);
  expect(auditCalls).toEqual(expected);
}

describe("tool arguments retain their complete values", () => {
  it("execute receives SDK args and every recorded surface carries the complete values", async () => {
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

    expectStructuredSurfacesToMatchCalls(run);
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

  it("execute and recorded surfaces receive unchanged legacy-provider args", async () => {
    const run = await runWithAllTools();

    expectStructuredSurfacesToMatchCalls(run);
    // Every tool executed exactly once, with the complete values.
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

    // History carries exactly the provider-supplied objects, without a
    // secondary projection step.
    const writeCall = run.history
      .flatMap((m) => m.parts)
      .find((p) => p.type === "toolCall" && p.toolName === "Write");
    expect(writeCall && writeCall.type === "toolCall" && writeCall.args).toEqual({
      path: "notes.txt",
      content: `token=${SECRETS.write}`,
    });

    const editCall = run.history
      .flatMap((m) => m.parts)
      .find((p) => p.type === "toolCall" && p.toolName === "Edit");
    expect(editCall && editCall.type === "toolCall" && editCall.args).toEqual({
      path: "notes.txt",
      old_string: `old ${SECRETS.edit}`,
      new_string: `new ${SECRETS.edit}`,
    });

    const bashCall = run.history
      .flatMap((m) => m.parts)
      .find((p) => p.type === "toolCall" && p.toolName === "Bash");
    expect(bashCall && bashCall.type === "toolCall" && bashCall.args).toEqual({
      command: `deploy --token=${SECRETS.bash}`,
    });

    const mcpCall = run.history
      .flatMap((m) => m.parts)
      .find((p) => p.type === "toolCall" && p.toolName === "mcp__ci__deploy");
    expect(mcpCall && mcpCall.type === "toolCall" && mcpCall.args).toEqual({ apiKey: SECRETS.mcp });

    const taskCall = run.history
      .flatMap((m) => m.parts)
      .find((p) => p.type === "toolCall" && p.toolName === "Task");
    expect(taskCall && taskCall.type === "toolCall" && taskCall.args).toEqual({
      agentType: "general",
      prompt: `use ${SECRETS.task}`,
    });

    const browserCall = run.history
      .flatMap((m) => m.parts)
      .find((p) => p.type === "toolCall" && p.toolName === "BrowserNavigate");
    expect(browserCall && browserCall.type === "toolCall" && browserCall.args).toEqual({
      url: `https://user:${SECRETS.browser}@example.com/path?q=1#frag`,
    });
  });

  it("permission requests and audit carry complete resources and args", async () => {
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
    expect(run.audit.map((entry) => entry.request.args)).toEqual(run.calls.map((call) => call.args));
  });

  it("a validateArgs failure becomes an error result; the tool never executes", async () => {
    const executed: Array<Record<string, unknown>> = [];
    const tool: Tool = {
      name: "Strict",
      description: "strict",
      readOnly: false,
      parameters: { type: "object" },
      async validateArgs(args) {
        if (typeof args.path !== "string") throw new Error(`Strict rejected path=${String(args.path)}`);
      },
      permissionResource: () => ({ action: "read", kind: "path", scope: "x" }),
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
    expect(result.content).toContain("Strict rejected path=42");
    const call = history
      .flatMap((message) => message.parts)
      .find((part) => part.type === "toolCall");
    expect(call && call.type === "toolCall" && call.args).toEqual({ path: 42 });
  });

  it("retains complete args and the original diagnostic when execution throws", async () => {
    const secret = "EXEC-SECRET-7c20d8";
    const tool: Tool = {
      name: "Failing",
      description: "failing",
      readOnly: false,
      parameters: { type: "object" },
      permissionResource: () => ({ action: "write", kind: "test", scope: "failing" }),
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

    expect(JSON.stringify([history, events])).toContain(secret);
    const result = history
      .flatMap((message) => message.parts)
      .find((part) => part.type === "toolResult") as { isError?: boolean; content: string };
    expect(result).toEqual(expect.objectContaining({
      isError: true,
      content: `remote rejected ${secret}`,
    }));
    const resultEvent = events.find((event) => event.type === "toolResult");
    expect(resultEvent).toEqual(expect.objectContaining({
      type: "toolResult",
      isError: true,
      content: `remote rejected ${secret}`,
    }));
  });

  it("a preparation failure keeps the diagnostic and complete args while the tool never runs", async () => {
    const executed: Array<Record<string, unknown>> = [];
    const tool: Tool = {
      name: "Broken",
      description: "broken",
      readOnly: false,
      parameters: { type: "object" },
      permissionResource: (args) => {
        if (typeof args.password !== "string") throw new Error("Broken 需要 password");
        throw new Error(`resource check failed for ${args.password}`);
      },
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
    expect(result.content).toContain("resource check failed for PREP-SECRET-11");
    // The call record keeps the original invocation for diagnosis.
    const call = history
      .flatMap((m) => m.parts)
      .find((p) => p.type === "toolCall") as { args: Record<string, unknown> };
    expect(call.args).toEqual({ password: "PREP-SECRET-11" });
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
