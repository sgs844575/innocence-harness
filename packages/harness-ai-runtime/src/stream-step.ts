import type {
  FinishReason,
  Message,
  ProviderModel,
  ToolSpec,
  TurnMetadata,
  UsageMetadata,
} from "@innocenceharness/harness-providers";
import type { SharedV3ProviderOptions } from "@ai-sdk/provider";
import {
  stepCountIs,
  streamText,
  type AssistantContent,
  type LanguageModel,
  type ModelMessage,
  type TextStreamPart,
  type ToolContent,
  type UserContent,
} from "ai";
import { hasUsage, toUsageMetadata } from "./metadata";
import { toSdkMessages } from "./message-mapping";
import { modelProtocolOf, toSdkRequestOptions } from "./request-options";
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
    // Anthropic prompt caching: the provider allows at most 4 cache
    // breakpoints per request. This runtime places exactly 2: breakpoint 1 at
    // the end of the system prompt (covers the stable system-prompt prefix)
    // and breakpoint 2 at the last part of the last message (rolls forward
    // with the growing message prefix). Every other protocol keeps the plain
    // string system prompt and untouched messages.
    const cacheBreakpointOptions: SharedV3ProviderOptions = {
      anthropic: { cacheControl: { type: "ephemeral" } },
    };
    const isAnthropic = modelProtocolOf(request.model.value) === "anthropic";
    const messages = toSdkMessages(request.messages);

    const result = streamText({
      model: request.model.value as LanguageModel,
      ...toSdkRequestOptions(request.model),
      system: isAnthropic
        ? [{ role: "system" as const, content: request.system, providerOptions: cacheBreakpointOptions }]
        : request.system,
      messages: isAnthropic ? withLastPartCacheBreakpoint(messages, cacheBreakpointOptions) : messages,
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
      yield { type: "error", error: toError(error) };
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
        content: toError(event.error).message,
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
      return { type: "error", error: toError(event.error) };
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

/** Serializes a thrown value for events and transcripts: the original
 * diagnostic verbatim (no redaction), with the cause errno appended when the
 * message does not already carry it. Empty messages fall back to the HTTP
 * status, then the cause errno, then String(value). */
export function formatUnknownError(error: unknown): string {
  if (typeof error === "string") return error;
  const shape = error as
    | {
        message?: unknown;
        statusCode?: unknown;
        status?: unknown;
        cause?: { code?: unknown; cause?: unknown } | null;
      }
    | null
    | undefined;
  if (shape !== null && typeof shape === "object") {
    const message = typeof shape.message === "string" ? shape.message.trim() : "";
    const errno = causeErrno(shape.cause);
    if (message.length > 0) {
      return errno !== undefined && !message.includes(errno) ? `${message} (${errno})` : message;
    }
    const status = shape.statusCode ?? shape.status;
    if (typeof status === "number") return `HTTP ${status}`;
    if (errno !== undefined) return errno;
  }
  return String(error);
}

/** First errno found on the cause chain (capped at 3 hops). */
function causeErrno(cause: unknown): string | undefined {
  let hop = 0;
  while (cause !== null && typeof cause === "object" && hop < 3) {
    const code = (cause as { code?: unknown }).code;
    if (typeof code === "string" && code.length > 0) return code;
    cause = (cause as { cause?: unknown }).cause;
    hop += 1;
  }
  return undefined;
}

/** Formats a model-request failure without removing provider diagnostics. */
export function classifyModelRequestError(error: unknown): string {
  return formatUnknownError(error);
}

function toError(error: unknown): { message: string } {
  return { message: classifyModelRequestError(error) };
}

/**
 * Attaches the cache breakpoint to a shallow copy of the last message's last
 * part. The input messages and their parts are never mutated: only the last
 * message and its last part are copied. Returns the input array unchanged
 * when there is no part to attach to.
 */
function withLastPartCacheBreakpoint(
  messages: ModelMessage[],
  providerOptions: SharedV3ProviderOptions,
): ModelMessage[] {
  const last = messages[messages.length - 1];
  if (!last) return messages;

  let patched: ModelMessage;
  switch (last.role) {
    case "user":
      patched =
        typeof last.content === "string"
          ? { ...last, content: [{ type: "text", text: last.content, providerOptions }] }
          : { ...last, content: patchUserContent(last.content, providerOptions) };
      break;
    case "assistant":
      patched =
        typeof last.content === "string"
          ? { ...last, content: [{ type: "text", text: last.content, providerOptions }] }
          : { ...last, content: patchAssistantContent(last.content, providerOptions) };
      break;
    case "tool":
      patched = { ...last, content: patchToolContent(last.content, providerOptions) };
      break;
    case "system":
      return messages;
  }

  const result = messages.slice();
  result[result.length - 1] = patched;
  return result;
}

function patchUserContent(
  parts: Exclude<UserContent, string>,
  providerOptions: SharedV3ProviderOptions,
): Exclude<UserContent, string> {
  return parts.map((part, index) =>
    index === parts.length - 1
      ? { ...part, providerOptions: { ...part.providerOptions, ...providerOptions } }
      : part,
  );
}

function patchAssistantContent(
  parts: Exclude<AssistantContent, string>,
  providerOptions: SharedV3ProviderOptions,
): Exclude<AssistantContent, string> {
  return parts.map((part, index) =>
    index === parts.length - 1 && part.type !== "tool-approval-request"
      ? { ...part, providerOptions: { ...part.providerOptions, ...providerOptions } }
      : part,
  );
}

function patchToolContent(
  parts: ToolContent,
  providerOptions: SharedV3ProviderOptions,
): ToolContent {
  return parts.map((part, index) =>
    index === parts.length - 1 && part.type !== "tool-approval-response"
      ? { ...part, providerOptions: { ...part.providerOptions, ...providerOptions } }
      : part,
  );
}
