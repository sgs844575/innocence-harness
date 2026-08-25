import type {
  FinishReason,
  Message,
  ProviderModel,
  ToolSpec,
  TurnMetadata,
  UsageMetadata,
} from "@innocenceharness/harness-providers";
import { stepCountIs, streamText, type LanguageModel, type TextStreamPart } from "ai";
import { hasUsage, toUsageMetadata } from "./metadata";
import { toSdkMessages } from "./message-mapping";
import { toSdkRequestOptions } from "./request-options";
import { toSdkTools, type SchemaOnlyTools } from "./tool-mapping";

export interface StreamOneHarnessStepRequest {
  model: ProviderModel;
  system: string;
  messages: readonly Message[];
  tools: readonly ToolSpec[];
  signal?: AbortSignal;
}

export type HarnessStepEvent =
  | { type: "text"; text: string }
  | { type: "reasoning"; text: string }
  | { type: "toolCall"; id: string; toolName: string; args: Record<string, unknown> }
  | { type: "toolResult"; id: string; toolName: string; content: string; isError?: boolean }
  | { type: "usage"; usage: UsageMetadata }
  | { type: "finish"; metadata: TurnMetadata }
  | { type: "abort" }
  | { type: "error"; error: { message: string } };

/**
 * Streams exactly one model invocation. Tool definitions are schema-only, so
 * calls are surfaced to the caller rather than executed by this runtime.
 */
export async function* streamOneHarnessStep(
  request: StreamOneHarnessStepRequest,
): AsyncGenerator<HarnessStepEvent> {
  if (request.signal?.aborted) {
    yield { type: "abort" };
    return;
  }

  try {
    const result = streamText({
      model: request.model.value as LanguageModel,
      ...toSdkRequestOptions(request.model),
      system: request.system,
      messages: toSdkMessages(request.messages),
      tools: toSdkTools(request.tools),
      abortSignal: request.signal,
      stopWhen: stepCountIs(1),
    });

    let latestUsage: UsageMetadata | undefined;
    let responseId: string | undefined;
    for await (const event of result.fullStream) {
      if (event.type === "finish") {
        const response = await result.response;
        responseId = typeof response.id === "string" && response.id.length > 0 ? response.id : undefined;
      }
      const mapped = mapStreamEvent(event, request.model, latestUsage, responseId);
      if (!mapped) continue;
      if (mapped.type === "usage") latestUsage = mapped.usage;
      yield mapped;
    }
  } catch (error) {
    if (request.signal?.aborted) {
      yield { type: "abort" };
    } else {
      yield { type: "error", error: toNeutralError(error) };
    }
  }
}

function mapStreamEvent(
  event: TextStreamPart<SchemaOnlyTools>,
  model: ProviderModel,
  latestUsage: UsageMetadata | undefined,
  responseId: string | undefined,
): HarnessStepEvent | undefined {
  switch (event.type) {
    case "text-delta":
      return event.text ? { type: "text", text: event.text } : undefined;
    case "reasoning-delta":
      return event.text ? { type: "reasoning", text: event.text } : undefined;
    case "tool-call":
      return {
        type: "toolCall",
        id: event.toolCallId,
        toolName: event.toolName,
        args: toRecord(event.input),
      };
    case "tool-result":
      return {
        type: "toolResult",
        id: event.toolCallId,
        toolName: event.toolName,
        content: stringifyToolOutput(event.output),
      };
    case "tool-error":
      return {
        type: "toolResult",
        id: event.toolCallId,
        toolName: event.toolName,
        content: toNeutralError(event.error).message,
        isError: true,
      };
    case "finish-step": {
      const usage = toUsageMetadata(event.usage);
      return hasUsage(usage) ? { type: "usage", usage } : undefined;
    }
    case "finish": {
      const usage = latestUsage ?? toUsageMetadata(event.totalUsage);
      return {
        type: "finish",
        metadata: {
          providerId: model.providerId,
          modelId: model.modelId,
          ...(hasUsage(usage) ? { usage } : {}),
          finishReason: event.finishReason as FinishReason,
          ...(responseId ? { responseId } : {}),
        },
      };
    }
    case "abort":
      return { type: "abort" };
    case "error":
      return { type: "error", error: toNeutralError(event.error) };
    default:
      return undefined;
  }
}

function toRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : { value };
}

function stringifyToolOutput(output: unknown): string {
  if (typeof output === "string") return output;
  return JSON.stringify(output);
}

const SAFE_MODEL_ERROR_MESSAGE = "Model request failed";

function toNeutralError(_error: unknown): { message: string } {
  return { message: SAFE_MODEL_ERROR_MESSAGE };
}
