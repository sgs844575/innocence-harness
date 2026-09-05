import { expect, it } from "vitest";
import type { LanguageModelV3 } from "@ai-sdk/provider";
import { createModelFactory } from "../src/model-factory";
import { toSdkRequestOptions } from "../src/request-options";

it.each([
  ["responses", "/v1/responses"],
  ["openai-compatible", "/v1/chat/completions"],
  ["anthropic", "/v1/messages"],
])("sends %s requests to the selected endpoint", async (protocol, path) => {
  let calledUrl = "";
  const model = createModelFactory().create({
    providerId: "gateway", protocol, modelId: "model", credential: "secret", baseURL: "https://example.invalid/v1",
    fetchImpl: (async (url) => { calledUrl = String(url); return new Response("rejected", { status: 400 }); }) as typeof fetch,
    requestOptions: { reasoningEffort: "high" },
  });
  await expect((model.value as LanguageModelV3).doGenerate({ prompt: [] })).rejects.toThrow();
  expect(calledUrl).toBe("https://example.invalid" + path);
  if (protocol === "responses") expect(toSdkRequestOptions(model).providerOptions).toEqual({ openai: { reasoningEffort: "high" } });
});
