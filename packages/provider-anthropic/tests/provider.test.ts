import { describe, expect, it, vi } from "vitest";
import type { ProviderModel } from "@innocenceharness/harness-providers";
import { createModelFactory, streamOneHarnessStep } from "@innocenceharness/harness-ai-runtime";
import { createAnthropicProvider } from "../src/index";

const SSE = [
  'data: {"type":"message_start","message":{"usage":{"input_tokens":9,"output_tokens":1}}}',
  "",
  'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}',
  "",
  'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"开始"}}',
  "",
  'data: {"type":"content_block_stop","index":0}',
  "",
  'data: {"type":"message_stop"}',
  "",
].join("\n");

describe("Anthropic wire transport through the shared model runtime", () => {
  it("streams text; transport hits the messages endpoint with the expected credentials", async () => {
    let capturedURL = "";
    let capturedInit: RequestInit | undefined;
    const model = createModelFactory().create({
      providerId: "anthropic",
      protocol: "anthropic",
      modelId: "claude-sonnet-4-5",
      credential: "test-key",
      fetchImpl: async (url, init) => {
        capturedURL = String(url);
        capturedInit = init;
        return new Response(SSE, {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        });
      },
    });

    const events = [];
    for await (const event of streamOneHarnessStep({
      model,
      system: "s",
      messages: [{ role: "user", parts: [{ type: "text", text: "读一下" }] }],
      tools: [],
    })) {
      events.push(event);
    }

    expect(capturedURL).toBe("https://api.anthropic.com/v1/messages");
    const headers = capturedInit!.headers as Record<string, string>;
    expect(headers["x-api-key"]).toBe("test-key");
    expect(headers["anthropic-version"]).toBe("2023-06-01");
    const wireBody = JSON.parse(String(capturedInit!.body));
    expect(wireBody.model).toBe("claude-sonnet-4-5");

    expect(events.filter((e) => e.type === "text")).toEqual([{ type: "text", text: "开始" }]);
  });
});

describe("Anthropic model factory", () => {
  it("creates a messages-protocol model through the shared runtime factory", () => {
    const model: ProviderModel = {
      value: { opaque: true },
      providerId: "anthropic",
      modelId: "claude-sonnet-4-5",
    };
    const create = vi.fn(() => model);
    const fetchImpl = vi.fn();

    const result = createAnthropicProvider(
      {
        apiKey: "secret",
        id: "anthropic",
        baseURL: "https://proxy.example.invalid/v1",
        model: "claude-sonnet-4-5",
        reasoningEffort: "high",
        fetchImpl,
      },
      { create } as never,
    );

    expect(create).toHaveBeenCalledWith({
      providerId: "anthropic",
      protocol: "anthropic",
      modelId: "claude-sonnet-4-5",
      credential: "secret",
      baseURL: "https://proxy.example.invalid/v1",
      fetchImpl,
      requestOptions: {
        reasoningEffort: "high",
        reasoningTokenBudget: 32768,
      },
    });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(result).toBe(model);
  });

  it("fails closed before model creation when no credential is available", () => {
    const previous = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    const create = vi.fn();

    try {
      expect(() => createAnthropicProvider({ model: "m" }, { create } as never)).toThrow("API key");
      expect(create).not.toHaveBeenCalled();
    } finally {
      if (previous === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = previous;
    }
  });
});
