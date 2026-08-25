import type { UsageMetadata } from "@innocenceharness/harness-providers";

export interface RuntimeUsage {
  inputTokens: number | undefined;
  outputTokens: number | undefined;
  totalTokens: number | undefined;
  outputTokenDetails: { reasoningTokens: number | undefined };
  inputTokenDetails: { cacheReadTokens: number | undefined };
}

export function toUsageMetadata(usage: RuntimeUsage): UsageMetadata {
  const inputTokens = usage.inputTokens;
  const outputTokens = usage.outputTokens;
  return {
    ...(inputTokens !== undefined ? { inputTokens } : {}),
    ...(outputTokens !== undefined ? { outputTokens } : {}),
    totalTokens: usage.totalTokens ?? sumTokens(inputTokens, outputTokens),
    ...(usage.outputTokenDetails.reasoningTokens !== undefined
      ? { reasoningTokens: usage.outputTokenDetails.reasoningTokens }
      : {}),
    ...(usage.inputTokenDetails.cacheReadTokens !== undefined
      ? { cachedInputTokens: usage.inputTokenDetails.cacheReadTokens }
      : {}),
  };
}

export function hasUsage(usage: UsageMetadata): boolean {
  return Object.values(usage).some((value) => value !== undefined);
}

function sumTokens(inputTokens: number | undefined, outputTokens: number | undefined): number | undefined {
  if (inputTokens === undefined && outputTokens === undefined) return undefined;
  return (inputTokens ?? 0) + (outputTokens ?? 0);
}
