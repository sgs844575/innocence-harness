import type { ProviderModel } from "@innocenceharness/harness-providers";
import { createModelFactory, type ModelFactory } from "@innocenceharness/harness-ai-runtime";

export interface AnthropicProviderConfig {
  apiKey?: string;
  apiFormat?: import("@innocenceharness/harness-providers").ApiFormat;
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
 * The runtime owns all provider SDK interaction, wire transport and mapping.
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
    ...(config.baseURL ? { baseURL: config.apiFormat === "messages" ? `${config.baseURL.replace(/\/+$/, "").replace(/\/v1$/, "")}/v1` : config.baseURL } : {}),
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

/** Dynamic staging entry: a host resolves this factory from approved plugin roots. */
export default createAnthropicProvider;
