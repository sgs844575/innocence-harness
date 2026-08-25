import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import type { ModelRequestOptions, ProviderModel } from "@innocenceharness/harness-providers";
import { registerModelProtocol } from "./request-options";

export type ProviderProtocol = "openai" | "openai-compatible" | "anthropic" | "google";

export interface ProviderProfile {
  providerId: string;
  protocol: ProviderProtocol | (string & {});
  modelId: string;
  credential?: string;
  baseURL?: string;
  /** Injectable only for SDK-bound model factory tests. */
  fetchImpl?: typeof fetch;
  requestOptions?: ModelRequestOptions;
  capabilities?: Readonly<Record<string, boolean | "unknown">>;
}

export interface ModelFactoryDependencies {
  createOpenAI?: (settings: {
    apiKey: string;
    baseURL?: string;
    name?: string;
    fetch?: typeof fetch;
  }) => { chat(modelId: string): unknown };
  createAnthropic?: (settings: {
    apiKey: string;
    baseURL?: string;
    name?: string;
    fetch?: typeof fetch;
  }) => { chat(modelId: string): unknown };
  createGoogleGenerativeAI?: (settings: {
    apiKey: string;
    baseURL?: string;
    name?: string;
    fetch?: typeof fetch;
  }) => { chat(modelId: string): unknown };
}

export interface ModelFactory {
  create(profile: ProviderProfile): ProviderModel;
}

function toSupportedProtocol(protocol: ProviderProfile["protocol"]): ProviderProtocol {
  switch (protocol) {
    case "openai":
      return "openai";
    case "openai-compatible":
      return "openai-compatible";
    case "anthropic":
      return "anthropic";
    case "google":
      return "google";
    default:
      throw new Error(`Unsupported provider protocol: ${protocol}`);
  }
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
        ...(profile.fetchImpl ? { fetch: profile.fetchImpl } : {}),
        name: profile.providerId,
      };
      const protocol = toSupportedProtocol(profile.protocol);
      let value: unknown;
      switch (protocol) {
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
      }

      registerModelProtocol(value, protocol);
      return {
        value,
        providerId: profile.providerId,
        modelId: profile.modelId,
        ...(profile.requestOptions ? { requestOptions: profile.requestOptions } : {}),
        ...(profile.capabilities ? { capabilities: profile.capabilities } : {}),
      };
    },
  };
}
