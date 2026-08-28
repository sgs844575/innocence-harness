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
const wire = (frames: string[]): string => frames.map((frame) => `data: ${frame}`).join("\n\n") + "\n\n";

const chunk = (o: object) => JSON.stringify(o);

const messageStart = (inputTokens: number) =>
  chunk({ type: "message_start", message: { usage: { input_tokens: inputTokens, output_tokens: 1 } } });

const TEXT_ONLY = wire([
  messageStart(25),
  chunk({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }),
  chunk({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "你好" } }),
  chunk({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "！" } }),
  chunk({ type: "content_block_stop", index: 0 }),
  chunk({ type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 12 } }),
  chunk({ type: "message_stop" }),
]);

const TEXT_AND_TOOL = wire([
  messageStart(25),
  chunk({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }),
  chunk({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "我来看看" } }),
  chunk({ type: "content_block_stop", index: 0 }),
  chunk({ type: "content_block_start", index: 1, content_block: { type: "tool_use", id: "toolu_01", name: "Read", input: {} } }),
  chunk({ type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: '{"path":"' } }),
  chunk({ type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: 'a.ts"}' } }),
  chunk({ type: "content_block_stop", index: 1 }),
  chunk({ type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 42 } }),
  chunk({ type: "message_stop" }),
]);

const MULTIPLE_TOOLS = wire([
  chunk({ type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "toolu_a", name: "Read", input: {} } }),
  chunk({ type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: '{"path":"x"}' } }),
  chunk({ type: "content_block_stop", index: 0 }),
  chunk({ type: "content_block_start", index: 1, content_block: { type: "tool_use", id: "toolu_b", name: "Grep", input: {} } }),
  chunk({ type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: '{"pattern":"foo"}' } }),
  chunk({ type: "content_block_stop", index: 1 }),
  chunk({ type: "message_stop" }),
]);

const THINKING_AND_TEXT = wire([
  chunk({ type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "" } }),
  chunk({ type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "盘算" } }),
  chunk({ type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "回答" } }),
  chunk({ type: "message_stop" }),
]);

// A non-retryable in-stream error: retryable error payloads would exercise the
// transport's retry policy instead of this package's event mapping.
const ERROR_STREAM = wire([
  chunk({ type: "error", error: { type: "invalid_request_error", message: "Overloaded" } }),
]);

const READ_TOOL: ToolSpec = { name: "Read", description: "r", parameters: { type: "object" } };
const GREP_TOOL: ToolSpec = { name: "Grep", description: "g", parameters: { type: "object" } };
const USER_READ: Message[] = [{ role: "user", parts: [{ type: "text", text: "读一下" }] }];

function replayModel(sse: string, status = 200): ProviderModel {
  return createModelFactory().create({
    providerId: "anthropic",
    protocol: "anthropic",
    modelId: "claude-sonnet-4-5",
    credential: "test-key",
    fetchImpl: async () => new Response(sse, { status, headers: { "content-type": "text/event-stream" } }),
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

describe("messages-protocol wire replay through the shared model runtime", () => {
  it("streams text with usage from message_start and message_delta", async () => {
    const events = await collect(replayModel(TEXT_ONLY));
    expect(events.filter((e) => e.type === "text")).toEqual([
      { type: "text", text: "你好" },
      { type: "text", text: "！" },
    ]);
    expect(events.filter((e) => e.type === "usage").at(-1)).toMatchObject({
      type: "usage",
      usage: { inputTokens: 25, outputTokens: 12 },
    });
    expect(events.at(-1)).toMatchObject({ type: "finish" });
  });

  it("aggregates tool_use input fragments into a complete call", async () => {
    const events = await collect(replayModel(TEXT_AND_TOOL));
    expect(events.filter((e) => e.type === "text")).toEqual([{ type: "text", text: "我来看看" }]);
    expect(events.filter((e) => e.type === "toolCall")).toEqual([
      { type: "toolCall", id: "toolu_01", toolName: "Read", args: { path: "a.ts" } },
    ]);
  });

  it("emits multiple tool calls in block order", async () => {
    const events = await collect(replayModel(MULTIPLE_TOOLS), [READ_TOOL, GREP_TOOL]);
    const calls = events.filter((e): e is Extract<HarnessStepEvent, { type: "toolCall" }> => e.type === "toolCall");
    expect(calls.map((c) => c.toolName)).toEqual(["Read", "Grep"]);
    expect(calls[0]).toMatchObject({ id: "toolu_a", args: { path: "x" } });
    expect(calls[1]).toMatchObject({ id: "toolu_b", args: { pattern: "foo" } });
  });

  it("maps thinking deltas to reasoning events", async () => {
    const events = await collect(replayModel(THINKING_AND_TEXT));
    expect(events.filter((e) => e.type === "reasoning")).toEqual([{ type: "reasoning", text: "盘算" }]);
    expect(events.filter((e) => e.type === "text")).toEqual([{ type: "text", text: "回答" }]);
  });

  it("surfaces error payloads as error events", async () => {
    const events = await collect(replayModel(ERROR_STREAM));
    expect(events.filter((e) => e.type === "error").length).toBeGreaterThan(0);
  });
});
