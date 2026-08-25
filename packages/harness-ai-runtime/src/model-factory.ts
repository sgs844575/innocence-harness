import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import type { ProviderModel } from "@innocenceharness/harness-providers";

export type ProviderProtocol = "openai" | "openai-compatible" | "anthropic" | "google";

export interface ProviderProfile {
  providerId: string;
  protocol: ProviderProtocol | (string & {});
  modelId: string;
  credential?: string;
  baseURL?: string;
  capabilities?: Readonly<Record<string, boolean | "unknown">>;
}

export interface ModelFactoryDependencies {
  createOpenAI?: (settings: {
    apiKey: string;
    baseURL?: string;
    name?: string;
  }) => { chat(modelId: string): unknown };
  createAnthropic?: (settings: {
    apiKey: string;
    baseURL?: string;
    name?: string;
  }) => { chat(modelId: string): unknown };
  createGoogleGenerativeAI?: (settings: {
    apiKey: string;
    baseURL?: string;
    name?: string;
  }) => { chat(modelId: string): unknown };
}

export interface ModelFactory {
  create(profile: ProviderProfile): ProviderModel;
}

/**
 * Creates opaque model carriers for the supported provider protocols. The
 * concrete model stays within this runtime package and is never exposed by the
 * provider-neutral package boundary.
 */
export function createModelFactory(dependencies: ModelFactoryDependencies = {}): ModelFactory {
  const openAI = dependencies.createOpenAI ?? createOpenAI;
  const anthropic = dependencies.createAnthropic ?? createAnthropic;
  const google = dependencies.createGoogleGenerativeAI ?? createGoogleGenerativeAI;

  return {
    create(profile) {
      const credential = profile.credential?.trim();
      if (!credential) throw new Error("Provider credential is required");

      const options = {
        apiKey: credential,
        ...(profile.baseURL ? { baseURL: profile.baseURL } : {}),
        name: profile.providerId,
      };
      let value: unknown;
      switch (profile.protocol) {
        case "openai":
        case "openai-compatible":
          value = openAI(options).chat(profile.modelId);
          break;
        case "anthropic":
          value = anthropic(options).chat(profile.modelId);
          break;
        case "google":
          value = google(options).chat(profile.modelId);
          break;
        default:
          throw new Error(`Unsupported provider protocol: ${profile.protocol}`);
      }

      return {
        value,
        providerId: profile.providerId,
        modelId: profile.modelId,
        ...(profile.capabilities ? { capabilities: profile.capabilities } : {}),
      };
    },
  };
}
