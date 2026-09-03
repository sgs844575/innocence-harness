// Canonical, provider-agnostic message model. Providers translate this to
// their own wire formats; the kernel only ever sees these types.

/** Loose alias for JSON Schema objects supplied by tools. */
export interface JsonSchema {
  [key: string]: unknown;
}

/** Neutral request defaults retained with an opaque model carrier. */
export interface ModelRequestOptions {
  temperature?: number;
  maxTokens?: number;
  reasoningEffort?: string;
  reasoningTokenBudget?: number;
}

/** Opaque carrier for a model owned by a runtime adapter. */
export interface ProviderModel {
  readonly value: unknown;
  readonly providerId: string;
  readonly modelId: string;
  readonly requestOptions?: ModelRequestOptions;
  readonly capabilities?: Readonly<Record<string, boolean | "unknown">>;
}

/** Token accounting normalized without exposing a provider wire payload. */
export interface UsageMetadata {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  reasoningTokens?: number;
  cachedInputTokens?: number;
}

export type FinishReason = "stop" | "length" | "content-filter" | "tool-calls" | "error" | "aborted" | "other";

/** Neutral metadata for one completed model turn. */
export interface TurnMetadata {
  providerId: string;
  modelId: string;
  usage?: UsageMetadata;
  finishReason?: FinishReason;
  /** Provider-issued response correlation id; treated as an opaque identifier. */
  responseId?: string;
}

/** Sanitized completion shared by events, persistence, and host callbacks. */
export interface TurnCompletion {
  providerId?: string;
  modelId?: string;
  usage?: UsageMetadata;
  finishReason: FinishReason;
  aborted: boolean;
  /** Provider-issued response correlation id; treated as an opaque identifier. */
  responseId?: string;
}

export interface TextPart {
  type: "text";
  text: string;
}

/** 推理/思考增量（DeepSeek reasoning_content、Anthropic thinking 等）。 */
export interface ThinkingPart {
  type: "thinking";
  text: string;
}

export interface ToolCallPart {
  type: "toolCall";
  id: string;
  toolName: string;
  args: Record<string, unknown>;
}

/** 工具结果携带的图像：base64 裸数据（无 data: 前缀），模型可见（视觉闭环）。 */
export interface ToolResultImage {
  mediaType: string;
  data: string;
}

export interface ToolResultPart {
  type: "toolResult";
  toolCallId: string;
  content: string;
  /** 随工具结果进历史并映射到 provider 的图像；事件/UI 面不携带。 */
  images?: ToolResultImage[];
  isError?: boolean;
}

export type MessagePart = TextPart | ThinkingPart | ToolCallPart | ToolResultPart;

export type MessageRole = "user" | "assistant";

export interface Message {
  role: MessageRole;
  parts: MessagePart[];
}
