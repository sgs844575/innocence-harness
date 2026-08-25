import type { ProviderModel } from "@innocenceharness/harness-providers";
import { createModelFactory, type ModelFactory } from "@innocenceharness/harness-ai-runtime";

export interface GoogleProviderConfig {
  apiKey?: string;
  baseURL?: string;
  model: string;
  temperature?: number;
  maxTokens?: number;
  id?: string;
  /** Injectable only for model-factory tests. */
  fetchImpl?: typeof fetch;
}

export type GoogleModelFactory = Pick<ModelFactory, "create">;

/** Creates an opaque native-protocol model through the shared runtime factory. */
export function createGoogleProvider(
  config: GoogleProviderConfig,
  factory: GoogleModelFactory = createModelFactory(),
): ProviderModel {
  const apiKey = config.apiKey ?? process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (!apiKey) {
    throw new Error("缺少 native provider API key（config.apiKey 或环境变量 GOOGLE_GENERATIVE_AI_API_KEY）");
  }

  return factory.create({
    providerId: config.id ?? "google",
    protocol: "google",
    modelId: config.model,
    credential: apiKey,
    ...(config.baseURL ? { baseURL: config.baseURL } : {}),
    ...(config.fetchImpl ? { fetchImpl: config.fetchImpl } : {}),
    ...(config.temperature !== undefined || config.maxTokens !== undefined ? {
      requestOptions: {
        ...(config.temperature !== undefined ? { temperature: config.temperature } : {}),
        ...(config.maxTokens !== undefined ? { maxTokens: config.maxTokens } : {}),
      },
    } : {}),
  });
}

/** Dynamic staging entry: a host resolves this factory from approved plugin roots. */
export const createGooglePlugin = createGoogleProvider;
export default createGoogleProvider;
