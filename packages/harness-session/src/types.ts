// Canonical, provider-agnostic message model. Providers translate this to
// their own wire formats; the kernel only ever sees these types.

/** Loose alias for JSON Schema objects supplied by tools. */
export interface JsonSchema {
  [key: string]: unknown;
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
  /** Per-invocation id (ctx.scope.invocationId), when the loop emitted one. */
  invocationId?: string;
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
  /** Matches the toolCall part of the same invocation, when known. */
  invocationId?: string;
}

/**
 * 内容寻址引用（附件与多模态）：消息只携带引用，永不携带原始 base64、
 * PDF 字节或绝对路径；字节经宿主的内容存储（CAS）按需解析。
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

export function textMessage(role: MessageRole, text: string): Message {
  return { role, parts: [{ type: "text", text }] };
}

/** True when a message carries no tool call/result parts (safe compaction boundary). */
export function isPlainText(message: Message): boolean {
  return (
    message.role === "user" &&
    message.parts.length > 0 &&
    message.parts.every((p) => p.type === "text")
  );
}

export function messageText(message: Message): string {
  return message.parts
    .filter((p): p is TextPart => p.type === "text")
    .map((p) => p.text)
    .join("");
}

/** `sha256:<64 hex>` 引用键形态（附件 CAS 键的规范化判定）。 */
const CONTENT_KEY_RE = /^sha256:[0-9a-f]{64}$/;

/** 形态校验的 ContentRef（防转录/IPC 侧伪造畸形引用）。 */
export function isContentRef(value: unknown): value is ContentRef {
  if (typeof value !== "object" || value === null) return false;
  const ref = value as Partial<ContentRef>;
  return (
    typeof ref.key === "string" && CONTENT_KEY_RE.test(ref.key) &&
    typeof ref.mediaType === "string" && ref.mediaType.length > 0 &&
    typeof ref.byteLength === "number" && ref.byteLength >= 0
  );
}

/** Serialize a message list to a readable transcript (used for compaction summaries). */
export function toTranscript(messages: Message[]): string {
  return messages
    .map((m) => {
      const who = m.role === "user" ? "用户" : "助手";
      const body = m.parts
        .map((p) => {
          switch (p.type) {
            case "text":
              return p.text;
            case "thinking":
              return `[思考] ${p.text.slice(0, 400)}`;
            case "toolCall":
              return `[调用工具 ${p.toolName}，参数 ${boundedArgs(p.args)}]`;
            case "toolResult":
              return `[工具结果${p.isError ? "（出错）" : ""}：${p.content.slice(0, 400)}]`;
            case "attachment":
              return `[附件 ${p.name}（${p.source.mediaType}，${p.representations.length} 个表示）]`;
          }
        })
        .join("\n");
      return `${who}：${body}`;
    })
    .join("\n\n");
}

/** 工具参数序列化进压缩摘要时有界（Edit/Write 正文封顶后仍可能很长）。 */
function boundedArgs(args: Record<string, unknown>, limit = 1200): string {
  let json: string;
  try {
    json = JSON.stringify(args);
  } catch {
    return "{…}";
  }
  return json.length <= limit ? json : `${json.slice(0, limit - 1)}…`;
}
