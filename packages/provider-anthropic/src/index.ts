import type { Provider, ProviderModel } from "@innocenceharness/harness-providers";
import { createModelFactory, type ModelFactory } from "@innocenceharness/harness-ai-runtime";
import { parseSSEData } from "@innocenceharness/harness-providers";
import { toAnthropicBody } from "./mapping";
import { anthropicDeltasFromDataLines } from "./stream";

export interface AnthropicProviderConfig {
  apiKey?: string;
  baseURL?: string;
  model: string;
  maxTokens?: number;
  temperature?: number;
  /** 思考档位（"low"|"medium"|"high"，映射为 thinking budget；off/undefined 不开启）。 */
  reasoningEffort?: string;
  id?: string;
  /** Injectable only for model-factory tests. */
  fetchImpl?: typeof fetch;
}

export type AnthropicModelFactory = Pick<ModelFactory, "create">;

/**
 * Creates an opaque messages-protocol model through the shared runtime factory.
 * The runtime owns all provider SDK interaction and network transport.
 */
export function createAnthropicProvider(
  config: AnthropicProviderConfig,
  factory: AnthropicModelFactory = createModelFactory(),
): ProviderModel {
  const apiKey = config.apiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("缺少 Anthropic API key（config.apiKey 或环境变量 ANTHROPIC_API_KEY）");
  }

  return factory.create({
    providerId: config.id ?? "anthropic",
    protocol: "anthropic",
    modelId: config.model,
    credential: apiKey,
    ...(config.baseURL ? { baseURL: config.baseURL } : {}),
    ...(config.fetchImpl ? { fetchImpl: config.fetchImpl } : {}),
    ...(hasRequestOptions(config) ? {
      requestOptions: {
        ...(config.temperature !== undefined ? { temperature: config.temperature } : {}),
        ...(config.maxTokens !== undefined ? { maxTokens: config.maxTokens } : {}),
        ...(config.reasoningEffort ? {
          reasoningEffort: config.reasoningEffort,
          reasoningTokenBudget: thinkingBudget(config.reasoningEffort),
        } : {}),
      },
    } : {}),
  });
}

function hasRequestOptions(config: AnthropicProviderConfig): boolean {
  return config.temperature !== undefined || config.maxTokens !== undefined || Boolean(config.reasoningEffort);
}

function thinkingBudget(reasoningEffort: string): number | undefined {
  if (reasoningEffort === "off") return undefined;
  return { low: 4096, medium: 16384, high: 32768, max: 65536 }[reasoningEffort] ?? 32768;
}

/**
 * Replays recorded messages-protocol wire fixtures. This is intentionally not
 * a production transport; production code must use {@link createAnthropicProvider}.
 */
export function createAnthropicFixtureProvider(config: AnthropicProviderConfig): Provider {
  const apiKey = config.apiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("缺少 Anthropic API key（config.apiKey 或环境变量 ANTHROPIC_API_KEY）");
  }
  const fetchImpl = config.fetchImpl;
  if (!fetchImpl) {
    throw new Error("fixture provider requires fetchImpl");
  }
  const baseURL = (config.baseURL ?? "https://api.anthropic.com").replace(/\/+$/, "");

  return {
    id: config.id ?? "anthropic",
    async *chat(req) {
      const res = await fetchImpl(`${baseURL}/v1/messages`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify(
          toAnthropicBody(req, {
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
        throw new Error(`Anthropic HTTP ${res.status}：${text.slice(0, 300)}`);
      }
      if (!res.body) throw new Error("Anthropic 响应没有 body");
      yield* anthropicDeltasFromDataLines(parseSSEData(res.body));
    },
  };
}

/** Dynamic staging entry: a host resolves this factory from approved plugin roots. */
export default createAnthropicProvider;

export { toAnthropicBody } from "./mapping";
export { anthropicDeltasFromDataLines } from "./stream";
