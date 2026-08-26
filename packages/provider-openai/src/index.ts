import type { Provider, ProviderModel } from "@innocenceharness/harness-providers";
import { createModelFactory, type ModelFactory } from "@innocenceharness/harness-ai-runtime";
import { parseSSEData } from "@innocenceharness/harness-providers";
import { toOpenAIBody } from "./mapping";
import { openAIDeltasFromDataLines } from "./stream";

export interface OpenAIProviderConfig {
  apiKey?: string;
  /** Override for OpenAI-compatible endpoints (Ollama, vLLM, gateways...). */
  baseURL?: string;
  model: string;
  maxTokens?: number;
  temperature?: number;
  /** 思考档位（"low"|"medium"|"high"…，"off"/undefined 不带参数）。 */
  reasoningEffort?: string;
  /** Provider id for the registry; default "openai". */
  id?: string;
  /** Injectable only for model-factory tests. */
  fetchImpl?: typeof fetch;
}

export type OpenAIModelFactory = Pick<ModelFactory, "create">;

/**
 * Creates an opaque compatible model through the shared runtime factory.
 * A configured base URL keeps the profile on the compatible protocol,
 * including legacy compatibility profiles.
 */
export function createOpenAIProvider(
  config: OpenAIProviderConfig,
  factory: OpenAIModelFactory = createModelFactory(),
): ProviderModel {
  const apiKey = config.apiKey ?? process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("缺少 OpenAI API key（config.apiKey 或环境变量 OPENAI_API_KEY）");
  }

  return factory.create({
    providerId: config.id ?? "openai",
    protocol: config.baseURL ? "openai-compatible" : "openai",
    modelId: config.model,
    credential: apiKey,
    ...(config.baseURL ? { baseURL: config.baseURL } : {}),
    ...(config.fetchImpl ? { fetchImpl: config.fetchImpl } : {}),
    ...(hasRequestOptions(config) ? {
      requestOptions: {
        ...(config.temperature !== undefined ? { temperature: config.temperature } : {}),
        ...(config.maxTokens !== undefined ? { maxTokens: config.maxTokens } : {}),
        ...(config.reasoningEffort ? { reasoningEffort: config.reasoningEffort } : {}),
      },
    } : {}),
  });
}

function hasRequestOptions(config: OpenAIProviderConfig): boolean {
  return config.temperature !== undefined || config.maxTokens !== undefined || Boolean(config.reasoningEffort);
}

/**
 * Replays captured wire fixtures. This is intentionally not a production
 * transport; production code must use {@link createOpenAIProvider}.
 */
export function createOpenAIFixtureProvider(config: OpenAIProviderConfig): Provider {
  const apiKey = config.apiKey ?? process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("缺少 OpenAI API key（config.apiKey 或环境变量 OPENAI_API_KEY）");
  }
  const fetchImpl = config.fetchImpl;
  if (!fetchImpl) {
    throw new Error("fixture provider requires fetchImpl");
  }
  const baseURL = (config.baseURL ?? "https://api.openai.com/v1").replace(/\/+$/, "");

  return {
    id: config.id ?? "openai",
    async *chat(req) {
      const res = await fetchImpl(`${baseURL}/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(
          toOpenAIBody(req, {
            model: config.model,
            maxTokens: config.maxTokens,
            temperature: config.temperature,
            reasoningEffort: config.reasoningEffort,
          }),
        ),
        signal: req.signal,
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`OpenAI HTTP ${res.status}：${text.slice(0, 300)}`);
      }
      if (!res.body) throw new Error("OpenAI 响应没有 body");
      yield* openAIDeltasFromDataLines(parseSSEData(res.body));
    },
  };
}

/** Dynamic staging entry: a host resolves this factory from approved plugin roots. */
export default createOpenAIProvider;

export { toOpenAIBody } from "./mapping";
export { openAIDeltasFromDataLines } from "./stream";
