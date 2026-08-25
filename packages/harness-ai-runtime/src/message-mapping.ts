import type { Message, MessagePart } from "@innocenceharness/harness-providers";
import type { ModelMessage } from "ai";

/** Maps canonical messages to runtime model messages without replaying thinking. */
export function toSdkMessages(messages: readonly Message[]): ModelMessage[] {
  const toolNames = new Map<string, string>();
  const mapped: ModelMessage[] = [];

  for (const message of messages) {
    if (message.role === "assistant") {
      const content = assistantContent(message.parts, toolNames);
      if (content.length > 0) mapped.push({ role: "assistant", content });
      continue;
    }

    const results = toolResults(message.parts, toolNames);
    if (results.length > 0) mapped.push({ role: "tool", content: results });

    const text = message.parts
      .filter((part): part is Extract<MessagePart, { type: "text" }> => part.type === "text")
      .map((part) => part.text)
      .join("");
    if (text) mapped.push({ role: "user", content: text });
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
          ? ({ type: "error-text" as const, value: part.content })
          : ({ type: "text" as const, value: part.content }),
      },
    ];
  });
}
