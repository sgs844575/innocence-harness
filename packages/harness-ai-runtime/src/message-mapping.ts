import type { AttachmentPart, Message, MessagePart } from "@innocenceharness/harness-providers";
import type { ModelMessage } from "ai";

/** 解析后的附件内容片段（与 ai-sdk user content 形态一致）。 */
export type ResolvedAttachmentPiece =
  | { type: "text"; text: string }
  | { type: "image"; image: string; mediaType: string };

/**
 * 附件解析器：宿主注入（CAS 读取 + 模型能力门控）。文本表示恒可送；图像
 * 表示仅视觉模型可送（false/unknown 时宿主自行给替代文本说明）。无解析器
 * 时附件以显式省略注记送达（结构化输出等旁路请求不静默丢引用）。
 */
export type AttachmentResolver = (part: AttachmentPart) => Promise<ResolvedAttachmentPiece[]>;

/**
 * Maps canonical messages to runtime model messages without replaying thinking.
 * Attachment parts resolve through the optional host resolver, preserving the
 * original canonical order of text and attachment pieces (spec §8).
 */
export async function toSdkMessages(
  messages: readonly Message[],
  resolveAttachment?: AttachmentResolver,
): Promise<ModelMessage[]> {
  const toolNames = new Map<string, string>();
  const mapped: ModelMessage[] = [];
  const recordedResults = new Set(messages.flatMap((message) =>
    message.role === "assistant" ? [] : message.parts.flatMap((part) =>
      part.type === "toolResult" ? [part.toolCallId] : [],
    ),
  ));

  for (const message of messages) {
    if (message.role === "assistant") {
      const content = assistantContent(message.parts, toolNames);
      if (content.length > 0) mapped.push({ role: "assistant", content });
      // Interrupted or partially persisted histories can end after a call.
      // Repair only the outbound copy; never invent a successful execution.
      const missing = message.parts.flatMap((part) =>
        part.type === "toolCall" && !recordedResults.has(part.id)
          ? [{
              type: "toolResult" as const,
              toolCallId: part.id,
              isError: true,
              content: "No tool result was recorded. Execution status is unknown. Verify the current state before retrying any action with side effects.",
            }]
          : [],
      );
      if (missing.length > 0) {
        mapped.push({ role: "tool", content: toolResults(missing, toolNames) });
      }
      continue;
    }

    const results = toolResults(message.parts, toolNames);
    if (results.length > 0) mapped.push({ role: "tool", content: results });

    // 视觉闭环：工具结果携带的图像以紧跟的 user 消息送达。各 chat
    // completions 兼容端点的 tool 消息只收文本，user 图像是所有 provider
    // 都支持的最大公约数路径。
    const images = message.parts.flatMap((part) =>
      part.type === "toolResult" ? (part.images ?? []) : [],
    );
    if (images.length > 0) {
      mapped.push({
        role: "user",
        content: [
          ...images.map((image) => ({
            type: "image" as const,
            image: image.data,
            mediaType: image.mediaType,
          })),
          {
            type: "text" as const,
            text: "The image(s) above were returned by the tool calls in this turn.",
          },
        ],
      });
    }

    // 用户内容：文本与附件按 canonical 顺序交错（规格 §8）；连续 text part
    // 归并；无附件时保持纯字符串形态（既有请求体与缓存前缀不变）。
    const pieces: ResolvedAttachmentPiece[] = [];
    let textRun: string | null = null;
    const flushText = (): void => {
      if (textRun) pieces.push({ type: "text", text: textRun });
      textRun = null;
    };
    for (const part of message.parts) {
      if (part.type === "text") {
        textRun = (textRun ?? "") + part.text;
        continue;
      }
      if (part.type === "attachment") {
        flushText();
        if (resolveAttachment) {
          pieces.push(...(await resolveAttachment(part)));
        } else {
          pieces.push({ type: "text", text: `[Attachment "${part.name}" is not included in this request.]` });
        }
      }
    }
    flushText();
    if (pieces.length === 0) continue;
    if (pieces.length === 1 && pieces[0]!.type === "text") {
      if (pieces[0]!.text) mapped.push({ role: "user", content: pieces[0]!.text });
      continue;
    }
    mapped.push({ role: "user", content: pieces });
  }

  return mapped;
}

function assistantContent(parts: readonly MessagePart[], toolNames: Map<string, string>) {
  const content: Array<
    | { type: "text"; text: string }
    | { type: "tool-call"; toolCallId: string; toolName: string; input: Record<string, unknown> }
  > = [];

  for (const part of parts) {
    if (part.type === "text" && part.text) {
      content.push({ type: "text", text: part.text });
    } else if (part.type === "toolCall") {
      toolNames.set(part.id, part.toolName);
      content.push({
        type: "tool-call",
        toolCallId: part.id,
        toolName: part.toolName,
        input: part.args,
      });
    }
  }
  return content;
}

function toolResults(parts: readonly MessagePart[], toolNames: ReadonlyMap<string, string>) {
  return parts.flatMap((part) => {
    if (part.type !== "toolResult") return [];
    const toolName = toolNames.get(part.toolCallId);
    if (!toolName) {
      throw new Error(`Tool result has no matching call: ${part.toolCallId}`);
    }
    return [
      {
        type: "tool-result" as const,
        toolCallId: part.toolCallId,
        toolName,
        output: part.isError
          ? ({ type: "error-text" as const, value: modelVisibleFailure(part.content) })
          : ({ type: "text" as const, value: modelVisibleSuccess(part.content) }),
      },
    ];
  });
}

/**
 * Some model protocols carry a native error bit for tool results while others
 * flatten every result to plain text. Keep the native `error-text` distinction
 * above, and also put a compact status envelope in the model-visible value so
 * every provider gives the agent the same success/failure signal. On failures,
 * the tool result content is explicitly identified as the failure reason.
 */
function modelVisibleSuccess(content: string): string {
  return `Tool call status: succeeded\nTool output:\n${content}`;
}

function modelVisibleFailure(reason: string): string {
  return `Tool call status: failed\nFailure reason:\n${reason}`;
}
