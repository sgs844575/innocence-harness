import type { SharedV3ProviderOptions } from "@ai-sdk/provider";
import type { ModelRequestOptions, ProviderModel } from "@innocenceharness/harness-providers";
import type { ProviderProtocol } from "./model-factory";

const protocolByModel = new WeakMap<object, ProviderProtocol>();

export function registerModelProtocol(value: unknown, protocol: ProviderProtocol): void {
  if (value && typeof value === "object") protocolByModel.set(value, protocol);
}

export function toSdkRequestOptions(model: ProviderModel): {
  temperature?: number;
  maxOutputTokens?: number;
  providerOptions?: SharedV3ProviderOptions;
} {
  const options = model.requestOptions;
  if (!options) return {};

  const protocol = protocolByModel.get(model.value as object) ?? protocolFor(model.value);
  const providerOptions = protocol ? toProviderOptions(protocol, options) : undefined;
  return {
    ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
    ...(options.maxTokens !== undefined ? { maxOutputTokens: options.maxTokens } : {}),
    ...(providerOptions ? { providerOptions } : {}),
  };
}

function protocolFor(value: unknown): ProviderProtocol | undefined {
  if (!value || typeof value !== "object") return undefined;
  const provider = (value as { provider?: unknown }).provider;
  if (typeof provider !== "string") return undefined;
  if (provider.startsWith("openai")) return "openai";
  if (provider.startsWith("anthropic")) return "anthropic";
  if (provider.startsWith("google")) return "google";
  return undefined;
}

function toProviderOptions(
  protocol: ProviderProtocol,
  options: ModelRequestOptions,
): SharedV3ProviderOptions | undefined {
  switch (protocol) {
    case "openai":
    case "openai-compatible":
      return optionsForCompatibleProtocol(options);
    case "anthropic":
      return optionsForMessagesProtocol(options);
    case "google":
      return optionsForNativeProtocol(options);
    default:
      return undefined;
  }
}

function optionsForCompatibleProtocol(options: ModelRequestOptions): SharedV3ProviderOptions | undefined {
  const reasoningEffort = options.reasoningEffort === "max" ? "xhigh" : options.reasoningEffort;
  return reasoningEffort && reasoningEffort !== "off"
    ? { openai: { reasoningEffort } }
    : undefined;
}

function optionsForMessagesProtocol(options: ModelRequestOptions): SharedV3ProviderOptions | undefined {
  if (options.reasoningEffort === "off") return undefined;
  if (options.reasoningTokenBudget !== undefined) {
    return {
      anthropic: {
        thinking: { type: "enabled", budgetTokens: options.reasoningTokenBudget },
      },
    };
  }
  return options.reasoningEffort ? { anthropic: { effort: options.reasoningEffort } } : undefined;
}

function optionsForNativeProtocol(options: ModelRequestOptions): SharedV3ProviderOptions | undefined {
  if (options.reasoningEffort === "off") return undefined;
  const thinkingConfig = {
    ...(options.reasoningTokenBudget !== undefined
      ? { thinkingBudget: options.reasoningTokenBudget }
      : {}),
    ...(toThinkingLevel(options.reasoningEffort) ? { thinkingLevel: toThinkingLevel(options.reasoningEffort) } : {}),
  };
  return Object.keys(thinkingConfig).length > 0 ? { google: { thinkingConfig } } : undefined;
}

function toThinkingLevel(effort: string | undefined): "low" | "medium" | "high" | undefined {
  switch (effort) {
    case "low":
    case "medium":
    case "high":
      return effort;
    case "max":
      return "high";
    default:
      return undefined;
  }
}
