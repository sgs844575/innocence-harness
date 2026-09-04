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
      message: expect.stringContaining("No object generated"),
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
      message: expect.stringContaining("could not parse the response"),
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
      message: expect.stringContaining("No object generated"),
    });
  });

  it("sends the JSON Schema instruction in both the system prompt and a final user message", async () => {
    const model = new MockLanguageModelV3({
      doGenerate: {
        content: [{ type: "text", text: '{"answer":"ok"}' }],
        finishReason: { unified: "stop", raw: "stop" },
        usage,
        warnings: [],
      },
    });

    await createStructuredOutputPort().generate({
      ...requestFor(model),
      system: "Base system prompt.",
    });

    const prompt = model.doGenerateCalls[0]!.prompt;
    const messages = Array.isArray(prompt) ? prompt : [prompt];
    const systemTurn = messages.find((entry) => (entry as { role?: string }).role === "system") as
      | { content: string }
      | undefined;
    expect(systemTurn?.content).toContain("Base system prompt.");
    expect(systemTurn?.content).toContain("Output format requirement");
    expect(systemTurn?.content).toContain("additionalProperties");
    const userTurns = messages.filter((entry) => (entry as { role?: string }).role === "user");
    expect(userTurns).toHaveLength(2);
    expect(JSON.stringify(userTurns[0])).toContain("Respond.");
    expect(JSON.stringify(userTurns[1])).toContain("Output format requirement");
  });

  it("recovers JSON wrapped in prose, fences, strings with braces or escaped quotes, and nested objects", async () => {
    const cases: Array<{ text: string; expected: object }> = [
      { text: 'Sure, here you go:\n```json\n{"answer":"ok"}\n```', expected: { answer: "ok" } },
      { text: 'result: {"answer":"she said \\"hi {ok}\\""}', expected: { answer: "she said \"hi {ok}\"" } },
      { text: 'nested {"answer":"x","extra":{"deep":{"braced":"}"}}} tail', expected: { answer: "x", extra: { deep: { braced: "}" } } } },
    ];
    for (const { text, expected } of cases) {
      const model = new MockLanguageModelV3({
        doGenerate: {
          content: [{ type: "text", text }],
          finishReason: { unified: "stop", raw: "stop" },
          usage,
          warnings: [],
        },
      });
      const result = await createStructuredOutputPort().generate({
        ...requestFor(model),
        schema: z.object({ answer: z.string(), extra: z.unknown().optional() }),
      });
      expect(result.object).toEqual(expected);
    }
  });

  it("generates an automation candidate with trigger, actions, constraints, and review summary only", async () => {
    const model = new MockLanguageModelV3({
      doGenerate: {
        content: [{
          type: "text",
          text: JSON.stringify({
            trigger: { kind: "schedule", expression: "0 9 * * 1", everyMs: 604_800_000 },
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
      trigger: { kind: "schedule", expression: "0 9 * * 1", everyMs: 604_800_000 },
      actions: [{ kind: "run-command", command: "test" }],
      constraints: ["read-only"],
      reviewSummary: "Review before enabling.",
    });
  });
});
