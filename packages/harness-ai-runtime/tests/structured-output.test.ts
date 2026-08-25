import { MockLanguageModelV3 } from "ai/test";
import { z } from "zod";
import { describe, expect, it } from "vitest";
import {
  AutomationCandidateSchema,
  createAutomationCandidateService,
  createStructuredOutputPort,
} from "../src/index";

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
        finishReason: { unified: "stop", raw: "structured-wire-finish-secret" },
        usage,
        warnings: [],
      },
    });

    const result = await createStructuredOutputPort().generate(requestFor(model));
    expect(result).toMatchObject({
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
      },
    });
    expect(result.metadata.responseId).toEqual(expect.any(String));
    expect(JSON.stringify(result)).not.toContain("rawFinishReason");
    expect(JSON.stringify(result)).not.toContain("structured-wire-finish-secret");
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

    await expect(createStructuredOutputPort().generate(requestFor(model))).rejects.toMatchObject({
      name: "StructuredOutputError",
      code: "schema-mismatch",
      message: "Structured output did not match the required schema",
    });
  });

  it("reports invalid JSON, aborts, and unsupported output capability without raw output", async () => {
    const invalidJson = new MockLanguageModelV3({
      doGenerate: {
        content: [{ type: "text", text: "private malformed response" }],
        finishReason: { unified: "stop", raw: "stop" },
        usage,
        warnings: [],
      },
    });
    const aborted = new AbortController();
    aborted.abort();

    await expect(createStructuredOutputPort().generate(requestFor(invalidJson))).rejects.toMatchObject({
      code: "invalid-json",
      message: "Structured output was not valid JSON",
    });
    await expect(createStructuredOutputPort().generate({ ...requestFor(invalidJson), signal: aborted.signal })).rejects.toMatchObject({
      code: "aborted",
      message: "Structured output generation was aborted",
    });
    await expect(createStructuredOutputPort().generate({
      ...requestFor(invalidJson),
      model: { value: invalidJson, providerId: "test", modelId: "model", capabilities: { structuredOutput: false } },
    })).rejects.toMatchObject({
      code: "provider-unsupported",
      message: "Structured output is not supported by this model",
    });
  });

  it("reports incomplete structured output separately from invalid complete JSON", async () => {
    const partial = new MockLanguageModelV3({
      doGenerate: {
        content: [{ type: "text", text: '{"answer":' }],
        finishReason: { unified: "length", raw: "length" },
        usage,
        warnings: [],
      },
    });

    await expect(createStructuredOutputPort().generate(requestFor(partial))).rejects.toMatchObject({
      code: "partial-output",
      message: "Structured output was incomplete",
    });
  });

  it("generates an automation candidate with trigger, actions, constraints, and review summary only", async () => {
    const model = new MockLanguageModelV3({
      doGenerate: {
        content: [{
          type: "text",
          text: JSON.stringify({
            trigger: { kind: "schedule", expression: "0 9 * * 1" },
            actions: [{ kind: "run-command", command: "test" }],
            constraints: ["read-only"],
            reviewSummary: "Review before enabling.",
          }),
        }],
        finishReason: { unified: "stop", raw: "stop" },
        usage,
        warnings: [],
      },
    });

    const result = await createAutomationCandidateService(createStructuredOutputPort()).generate({
      model: { value: model, providerId: "test", modelId: "model" },
      messages: [{ role: "user", parts: [{ type: "text", text: "Suggest an automation." }] }],
    });

    expect(AutomationCandidateSchema.parse(result.candidate)).toEqual(result.candidate);
    expect(result.candidate).toEqual({
      trigger: { kind: "schedule", expression: "0 9 * * 1" },
      actions: [{ kind: "run-command", command: "test" }],
      constraints: ["read-only"],
      reviewSummary: "Review before enabling.",
    });
  });
});
