import { describe, expect, it } from "vitest";
import type { Message, ProviderModel, ToolSpec } from "@innocenceharness/harness-providers";
import {
  createModelFactory,
  streamOneHarnessStep,
  type HarnessStepEvent,
} from "@innocenceharness/harness-ai-runtime";

// Full wire frames (SSE `data:` lines) replayed through the shared model
// runtime — SSE parsing and payload mapping below this boundary belong to
// the runtime and its protocol stack, not to this package.
const wire = (frames: string[]): string =>
  frames.map((frame) => `data: ${frame}`).join("\n\n") + "\n\ndata: [DONE]\n\n";

const chunk = (o: object) => JSON.stringify(o);

const TEXT_ONLY = wire([
  chunk({ choices: [{ index: 0, delta: { role: "assistant", content: "你好" }, finish_reason: null }] }),
  chunk({ choices: [{ index: 0, delta: { content: "，世界" }, finish_reason: null }] }),
  chunk({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }] }),
  chunk({ choices: [{ index: 0, delta: {} }], usage: { prompt_tokens: 10, completion_tokens: 5 } }),
]);

const FRAGMENTED_TOOL = wire([
  chunk({ choices: [{ index: 0, delta: { content: "让我读一下" }, finish_reason: null }] }),
  chunk({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "call_abc", type: "function", function: { name: "Read", arguments: "" } }] }, finish_reason: null }] }),
  chunk({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: '{"path":"a' } }] }, finish_reason: null }] }),
  chunk({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: '.ts"}' } }] }, finish_reason: null }] }),
  chunk({ choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] }),
]);

const MULTIPLE_TOOLS = wire([
  chunk({ choices: [{ index: 0, delta: { tool_calls: [
    { index: 0, id: "call_1", type: "function", function: { name: "Read", arguments: '{"path":"x"}' } },
    { index: 1, id: "call_2", type: "function", function: { name: "Grep", arguments: '{"pat' } },
  ] }, finish_reason: null }] }),
  chunk({ choices: [{ index: 0, delta: { tool_calls: [{ index: 1, function: { arguments: 'tern":"foo"}' } }] }, finish_reason: null }] }),
  chunk({ choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] }),
]);

const ERROR_STREAM = wire([
  chunk({ error: { message: "Incorrect API key provided", type: "invalid_request_error" } }),
]);

const READ_TOOL: ToolSpec = { name: "Read", description: "read", parameters: { type: "object" } };
const GREP_TOOL: ToolSpec = { name: "Grep", description: "g", parameters: { type: "object" } };
const USER_READ: Message[] = [{ role: "user", parts: [{ type: "text", text: "读 a.ts" }] }];

type ReplayOptions = {
  sse: string;
  status?: number;
  capture?: (url: string, init: RequestInit) => void;
};

function replayModel({ sse, status = 200, capture }: ReplayOptions): ProviderModel {
  return createModelFactory().create({
    providerId: "openai",
    protocol: "openai",
    modelId: "gpt-4o",
    credential: "test-key",
    fetchImpl: async (url, init) => {
      capture?.(String(url), init ?? {});
      return new Response(sse, { status, headers: { "content-type": "text/event-stream" } });
    },
  });
}

async function collect(model: ProviderModel, tools: ToolSpec[] = [READ_TOOL]): Promise<HarnessStepEvent[]> {
  const events: HarnessStepEvent[] = [];
  for await (const event of streamOneHarnessStep({
    model,
    system: "s",
    messages: USER_READ,
    tools,
  })) {
    events.push(event);
  }
  return events;
}

describe("OpenAI-compatible wire replay through the shared model runtime", () => {
  it("streams pure text and reports usage", async () => {
    const events = await collect(replayModel({ sse: TEXT_ONLY }));
    expect(events.filter((e) => e.type === "text")).toEqual([
      { type: "text", text: "你好" },
      { type: "text", text: "，世界" },
    ]);
    expect(events.filter((e) => e.type === "usage")).toMatchObject([
      { type: "usage", usage: { inputTokens: 10, outputTokens: 5 } },
    ]);
    expect(events.at(-1)).toMatchObject({ type: "finish" });
  });

  it("aggregates fragmented tool-call arguments into one complete call", async () => {
    const events = await collect(replayModel({ sse: FRAGMENTED_TOOL }));
    expect(events.filter((e) => e.type === "text")).toEqual([{ type: "text", text: "让我读一下" }]);
    expect(events.filter((e) => e.type === "toolCall")).toEqual([
      { type: "toolCall", id: "call_abc", toolName: "Read", args: { path: "a.ts" } },
    ]);
  });

  it("aggregates multiple parallel tool calls in index order", async () => {
    const events = await collect(replayModel({ sse: MULTIPLE_TOOLS }), [READ_TOOL, GREP_TOOL]);
    const calls = events.filter((e): e is Extract<HarnessStepEvent, { type: "toolCall" }> => e.type === "toolCall");
    expect(calls.map((c) => c.toolName)).toEqual(["Read", "Grep"]);
    expect(calls[1]).toMatchObject({ args: { pattern: "foo" } });
  });

  it("surfaces in-stream error payloads as error events", async () => {
    const events = await collect(replayModel({ sse: ERROR_STREAM }));
    expect(events.filter((e) => e.type === "error").length).toBeGreaterThan(0);
  });

  it("hits the chat-completions endpoint with bearer credentials and the requested model", async () => {
    let capturedURL = "";
    let capturedInit: RequestInit | undefined;
    await collect(
      replayModel({
        sse: TEXT_ONLY,
        capture: (url, init) => {
          capturedURL = url;
          capturedInit = init;
        },
      }),
    );
    expect(capturedURL).toBe("https://api.openai.com/v1/chat/completions");
    expect((capturedInit!.headers as Record<string, string>).authorization).toBe("Bearer test-key");
    const wireBody = JSON.parse(String(capturedInit!.body));
    expect(wireBody.model).toBe("gpt-4o");
    expect(wireBody.messages[0].role).toBe("system");
  });
});
