import { convertArrayToReadableStream, MockLanguageModelV3 } from "ai/test";
import { describe, expect, it, vi } from "vitest";
import { createModelFactory, streamOneHarnessStep } from "../src/index";

const usage = {
  inputTokens: { total: 3, noCache: 3, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 2, text: 1, reasoning: 1 },
};

async function collect<T>(stream: AsyncIterable<T>): Promise<T[]> {
  const events: T[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

describe("streamOneHarnessStep", () => {
  it("maps text, reasoning, full tool-call arguments, usage, and finish metadata", async () => {
    const model = new MockLanguageModelV3({
      provider: "test",
      modelId: "model",
      doStream: {
        stream: convertArrayToReadableStream([
          { type: "stream-start", warnings: [] },
          { type: "text-start", id: "text-1" },
          { type: "text-delta", id: "text-1", delta: "Hello" },
          { type: "reasoning-start", id: "reasoning-1" },
          { type: "reasoning-delta", id: "reasoning-1", delta: "considered" },
          { type: "tool-input-start", id: "call-1", toolName: "shell" },
          { type: "tool-input-delta", id: "call-1", delta: '{"command":"pwd"}' },
          { type: "tool-input-end", id: "call-1" },
          { type: "tool-call", toolCallId: "call-1", toolName: "shell", input: '{"command":"pwd"}' },
          { type: "tool-result", toolCallId: "call-1", toolName: "shell", result: { cwd: "/workspace" } },
          {
            type: "finish",
            usage,
            finishReason: { unified: "tool-calls", raw: "native-wire-finish-secret" },
          },
        ]),
      },
    });

    const events = await collect(
      streamOneHarnessStep({
        model: { value: model, providerId: "test", modelId: "model" },
        system: "system",
        messages: [{ role: "user", parts: [{ type: "text", text: "Hi" }] }],
        tools: [{ name: "shell", description: "run", parameters: { type: "object" } }],
      }),
    );

    expect(events).toEqual([
      { type: "text", text: "Hello" },
      { type: "reasoning", text: "considered" },
      { type: "toolCall", id: "call-1", toolName: "shell", args: { command: "pwd" } },
      { type: "toolResult", id: "call-1", toolName: "shell", content: '{"cwd":"/workspace"}' },
      {
        type: "usage",
        usage: {
          inputTokens: 3,
          outputTokens: 2,
          totalTokens: 5,
          reasoningTokens: 1,
          cachedInputTokens: 0,
        },
      },
      {
        type: "finish",
        metadata: {
          providerId: "test",
          modelId: "model",
          usage: {
            inputTokens: 3,
            outputTokens: 2,
            totalTokens: 5,
            reasoningTokens: 1,
            cachedInputTokens: 0,
          },
          finishReason: "tool-calls",
        },
      },
    ]);
    expect(JSON.stringify(events)).not.toContain("native-wire-finish-secret");
    expect(JSON.stringify(events)).not.toContain("rawFinishReason");
  });

  it("forwards neutral request options without exposing them in step metadata", async () => {
    const model = new MockLanguageModelV3({
      doStream: {
        stream: convertArrayToReadableStream([
          { type: "stream-start", warnings: [] },
          {
            type: "finish",
            usage,
            finishReason: { unified: "stop", raw: "native-wire-finish-options" },
          },
        ]),
      },
    });
    const carrier = createModelFactory({
      createOpenAI: () => ({ chat: () => model }),
    }).create({
      providerId: "configured-profile",
      protocol: "openai",
      modelId: "model",
      credential: "secret",
      requestOptions: {
        temperature: 0.2,
        maxTokens: 4096,
        reasoningEffort: "high",
        reasoningTokenBudget: 32768,
      },
    });

    const events = await collect(
      streamOneHarnessStep({
        model: carrier,
        system: "system",
        messages: [{ role: "user", parts: [{ type: "text", text: "Hi" }] }],
        tools: [{ name: "shell", description: "run", parameters: { type: "object" } }],
      }),
    );

    expect(model.doStreamCalls).toHaveLength(1);
    expect(model.doStreamCalls[0]).toMatchObject({
      temperature: 0.2,
      maxOutputTokens: 4096,
      providerOptions: {
        openai: { reasoningEffort: "high" },
      },
    });
    expect(model.doStreamCalls[0]?.tools?.every((tool) => tool.type === "function")).toBe(true);
    expect(model.doStreamCalls[0]?.tools?.every(
      (tool) => (tool as { execute?: unknown }).execute === undefined,
    )).toBe(true);
    expect(JSON.stringify(events)).not.toContain("temperature");
    expect(JSON.stringify(events)).not.toContain("maxTokens");
    expect(JSON.stringify(events)).not.toContain("reasoningEffort");
    expect(JSON.stringify(events)).not.toContain("native-wire-finish-options");
  });

  it("normalizes compatible max reasoning effort to xhigh before the SDK call", async () => {
    const model = new MockLanguageModelV3({
      doStream: {
        stream: convertArrayToReadableStream([
          { type: "stream-start", warnings: [] },
          { type: "finish", usage, finishReason: { unified: "stop", raw: "max-wire-finish" } },
        ]),
      },
    });
    const carrier = createModelFactory({
      createOpenAI: () => ({ chat: () => model }),
    }).create({
      providerId: "compatible-profile",
      protocol: "openai-compatible",
      modelId: "model",
      credential: "secret",
      requestOptions: { reasoningEffort: "max" },
    });

    const events = await collect(
      streamOneHarnessStep({
        model: carrier,
        system: "system",
        messages: [{ role: "user", parts: [{ type: "text", text: "Hi" }] }],
        tools: [],
      }),
    );

    expect(model.doStreamCalls[0]).toMatchObject({
      providerOptions: { openai: { reasoningEffort: "xhigh" } },
    });
    expect(JSON.stringify(model.doStreamCalls[0])).not.toContain('"max"');
    expect(JSON.stringify(events)).not.toContain("xhigh");
    expect(JSON.stringify(events)).not.toContain("max-wire-finish");
  });

  it("normalizes provider stream errors without provider payloads", async () => {
    const model = new MockLanguageModelV3({
      doStream: {
        stream: convertArrayToReadableStream([
          { type: "stream-start", warnings: [] },
          { type: "error", error: new Error("upstream unavailable") },
        ]),
      },
    });

    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const events = await collect(
        streamOneHarnessStep({
          model: { value: model, providerId: "test", modelId: "model" },
          system: "system",
          messages: [{ role: "user", parts: [{ type: "text", text: "Hi" }] }],
          tools: [],
        }),
      );

      expect(events).toEqual([
        { type: "error", error: { message: "Model request failed" } },
        {
          type: "finish",
          metadata: { providerId: "test", modelId: "model", finishReason: "error" },
        },
      ]);
    } finally {
      consoleError.mockRestore();
    }
  });

  it("does not expose sensitive provider error content in events or metadata", async () => {
    const sensitiveMessage = 'apiKey=secret prompt=private-prompt args={"path":"private-tool-args"}';
    const model = new MockLanguageModelV3({
      doStream: {
        stream: convertArrayToReadableStream([
          { type: "stream-start", warnings: [] },
          { type: "error", error: new Error(sensitiveMessage) },
        ]),
      },
    });

    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const events = await collect(
        streamOneHarnessStep({
          model: { value: model, providerId: "test", modelId: "model" },
          system: "system",
          messages: [{ role: "user", parts: [{ type: "text", text: "Hi" }] }],
          tools: [],
        }),
      );
      const exposed = JSON.stringify(events);

      expect(events).toContainEqual({ type: "error", error: { message: "Model request failed" } });
      expect(exposed).not.toContain("apiKey=secret");
      expect(exposed).not.toContain("private-prompt");
      expect(exposed).not.toContain("private-tool-args");
    } finally {
      consoleError.mockRestore();
    }
  });

  it("emits an abort event when the caller has already stopped the step", async () => {
    const controller = new AbortController();
    controller.abort();
    const model = new MockLanguageModelV3();

    const events = await collect(
      streamOneHarnessStep({
        model: { value: model, providerId: "test", modelId: "model" },
        system: "system",
        messages: [{ role: "user", parts: [{ type: "text", text: "Hi" }] }],
        tools: [],
        signal: controller.signal,
      }),
    );

    expect(events).toEqual([{ type: "abort" }]);
  });
});
