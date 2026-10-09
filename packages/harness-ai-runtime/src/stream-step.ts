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
import { toSdkMessages, type AttachmentResolver } from "./message-mapping";
import { modelProtocolOf, toSdkRequestOptions } from "./request-options";
import { toSdkTools, type SchemaOnlyTools } from "./tool-mapping";
import { createTextToolCallGate, textToolCallTable, type TextToolCallGateOutput } from "./text-tool-calls";

export interface StreamOneHarnessStepRequest {
  model: ProviderModel;
  system: string;
  messages: readonly Message[];
  tools: readonly ToolSpec[];
  signal?: AbortSignal;
  /** 附件解析器（宿主注入：CAS 读取 + 视觉能力门控）；缺省时附件以省略注记送达。 */
  resolveAttachment?: AttachmentResolver;
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

  // 兼容端点可能把工具调用以纯文本标记输出：经门处理后要么放行原文，
  // 要么在 finish 时还原成 toolCall 事件（见 text-tool-calls.ts）。
  const textGate = createTextToolCallGate(textToolCallTable(request.tools));
  const gateEvents = function* (outputs: readonly TextToolCallGateOutput[]): Generator<HarnessStepEvent> {
    for (const output of outputs) {
      if (output.kind === "text") {
        if (output.text) yield { type: "text", text: output.text };
      } else {
        for (const call of output.calls) {
          yield { type: "toolCall", id: call.id, toolName: call.toolName, args: call.args };
        }
      }
    }
  };

  try {
    // Anthropic prompt caching: the provider allows at most 4 cache
    // breakpoints per request. This runtime places up to 4, all ephemeral:
    // (1) the last tool definition — keeps the tool block (the largest stable
    //     prefix) cached even when the system prompt differs between requests;
    // (2) the end of the system prompt — the stable system-prompt prefix;
    // (3) the previous-turn boundary (last part of the message before the
    //     final assistant message) — always coincides with the previous
    //     request's last-message breakpoint, so the rolling chain still hits
    //     when the newest tail was rewritten (resend, aborted-turn repair);
    // (4) the last part of the last message — rolls forward with the growing
    //     message prefix. Every other protocol keeps the plain string system
    //     prompt and untouched tools and messages.
    const cacheBreakpointOptions: SharedV3ProviderOptions = {
      anthropic: { cacheControl: { type: "ephemeral" } },
    };
    const isAnthropic = modelProtocolOf(request.model.value) === "anthropic";
    const messages = await toSdkMessages(request.messages, request.resolveAttachment);

    const result = streamText({
      model: request.model.value as LanguageModel,
      ...toSdkRequestOptions(request.model),
      system: isAnthropic
        ? [{ role: "system" as const, content: request.system, providerOptions: cacheBreakpointOptions }]
        : request.system,
      messages: isAnthropic ? withCacheBreakpoints(messages, cacheBreakpointOptions) : messages,
      tools: toSdkTools(
        request.tools,
        isAnthropic ? { lastToolProviderOptions: cacheBreakpointOptions } : undefined,
      ),
      abortSignal: request.signal,
      stopWhen: stepCountIs(1),
    });

    let latestUsage: UsageMetadata | undefined;
    let responseId: string | undefined;
    for await (const event of result.fullStream) {
      if (event.type === "finish") {
        const response = await result.response;
        responseId = typeof response.id === "string" && response.id.length > 0 ? response.id : undefined;
        yield* gateEvents(textGate.finalize());
      }
      if (event.type === "text-delta") {
        const released = textGate.pushText(event.text);
        if (released) yield { type: "text", text: released };
        continue;
      }
      if (event.type === "abort" || event.type === "error") {
        const held = textGate.flushAsText();
        if (held) yield { type: "text", text: held };
      }
      const mapped = mapStreamEvent(event, request.model, latestUsage, responseId);
      if (!mapped) continue;
      if (mapped.type === "usage") latestUsage = mapped.usage;
      yield mapped;
    }
    yield* gateEvents(textGate.finalize());
  } catch (error) {
    const held = textGate.flushAsText();
    if (held) yield { type: "text", text: held };
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
 * Attaches cache breakpoints to shallow copies of the marked messages' last
 * parts: the last message (rolling prefix boundary) and, when the tail holds a
 * final assistant message, the message before it (previous-turn checkpoint —
 * the position the previous request's last-message breakpoint already cached).
 * The input messages and their parts are never mutated: only the marked
 * messages and their last parts are copied. Returns the input array unchanged
 * when there is no part to attach to.
 */
function withCacheBreakpoints(
  messages: ModelMessage[],
  providerOptions: SharedV3ProviderOptions,
): ModelMessage[] {
  if (messages.length === 0) return messages;

  // Previous-turn checkpoint: the message right before the final assistant
  // message (skipped when the assistant is first or absent — the first-turn
  // tail has no earlier boundary worth pinning).
  let checkpointIndex = -1;
  for (let i = messages.length - 2; i >= 0; i--) {
    if (messages[i]!.role === "assistant") {
      checkpointIndex = i - 1;
      break;
    }
  }
  const lastIndex = messages.length - 1;
  const indices =
    checkpointIndex >= 0 && checkpointIndex !== lastIndex
      ? [checkpointIndex, lastIndex]
      : [lastIndex];

  const result = messages.slice();
  for (const index of indices) {
    const marked = withMessageBreakpoint(result[index]!, providerOptions);
    if (marked !== result[index]) result[index] = marked;
  }
  return result;
}

/** Attaches the breakpoint to a shallow copy of one message's last part. */
function withMessageBreakpoint(
  message: ModelMessage,
  providerOptions: SharedV3ProviderOptions,
): ModelMessage {
  let patched: ModelMessage;
  switch (message.role) {
    case "user":
      patched =
        typeof message.content === "string"
          ? { ...message, content: [{ type: "text", text: message.content, providerOptions }] }
          : { ...message, content: patchUserContent(message.content, providerOptions) };
      break;
    case "assistant":
      patched =
        typeof message.content === "string"
          ? { ...message, content: [{ type: "text", text: message.content, providerOptions }] }
          : { ...message, content: patchAssistantContent(message.content, providerOptions) };
      break;
    case "tool":
      patched = { ...message, content: patchToolContent(message.content, providerOptions) };
      break;
    case "system":
      return message;
  }
  return patched;
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
