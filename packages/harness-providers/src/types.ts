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

/** Token accounting normalized across provider adapters. */
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

/** Completion shared by events, persistence, and host callbacks. */
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

/**
 * 内容寻址引用（附件与多模态）：消息只携带引用，字节经宿主 CAS 解析。
 * 镜像契约：与 harness-session 同名类型逐字一致，修改任一侧必须同步另一侧。
 */
export interface ContentRef {
  /** CAS 键，固定形态 `sha256:<64 hex>`。 */
  key: string;
  mediaType: string;
  byteLength: number;
  estimatedTokens?: number;
}

/** 附件的一条模型可见表示（文本抽取或规范化图像；PDF 表示带页码）。 */
export interface AttachmentRepresentation {
  kind: "text" | "image";
  content: ContentRef;
  page?: number;
}

/** 用户附件 part：source 为原始导入对象，representations 为按模型能力选送的表示。 */
export interface AttachmentPart {
  type: "attachment";
  name: string;
  source: ContentRef;
  representations: AttachmentRepresentation[];
}

export type MessagePart = TextPart | ThinkingPart | ToolCallPart | ToolResultPart | AttachmentPart;

export type MessageRole = "user" | "assistant";

export interface Message {
  role: MessageRole;
  parts: MessagePart[];
}
