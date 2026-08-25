import { MockLanguageModelV3 } from "ai/test";
import { z } from "zod";
import { describe, expect, it } from "vitest";
import { createStructuredOutputPort, StructuredOutputError } from "../src/index";

const usage = {
  inputTokens: { total: 2, noCache: 2, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 3, text: 3, reasoning: 0 },
};

function requestFor(model: unknown) {
  return {
    model: { value: model, providerId: "test", modelId: "model" },
    messages: [{ role: "user" as const, parts: [{ type: "text" as const, text: "Respond." }] }],
    schema: z.object({ answer: z.string() }),
  };
}

describe("createStructuredOutputPort", () => {
  it("returns a validated object and neutral turn metadata", async () => {
    const model = new MockLanguageModelV3({
      doGenerate: {
        content: [{ type: "text", text: '{"answer":"ok"}' }],
        finishReason: { unified: "stop", raw: "stop" },
        usage,
        warnings: [],
      },
    });

    await expect(createStructuredOutputPort().generate(requestFor(model))).resolves.toEqual({
      object: { answer: "ok" },
      metadata: {
        providerId: "test",
        modelId: "model",
        usage: {
          inputTokens: 2,
          outputTokens: 3,
          totalTokens: 5,
          reasoningTokens: 0,
          cachedInputTokens: 0,
        },
        finishReason: "stop",
        rawFinishReason: "stop",
      },
    });
  });

  it("normalizes schema validation failures without raw model output", async () => {
    const model = new MockLanguageModelV3({
      doGenerate: {
        content: [{ type: "text", text: '{"answer":42}' }],
        finishReason: { unified: "stop", raw: "stop" },
        usage,
        warnings: [],
      },
    });

    await expect(createStructuredOutputPort().generate(requestFor(model))).rejects.toEqual(
      new StructuredOutputError(),
    );
  });
});
