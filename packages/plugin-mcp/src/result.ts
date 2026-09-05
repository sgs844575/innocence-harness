import type { ToolImage, ToolResult } from "@innocenceharness/harness-tools";

export interface McpCallResult {
  content?: unknown[];
  isError?: boolean;
}

const MAX_TOOL_OUTPUT_CHARS = 16_000;
const NO_CONTENT_NOTE = "[The server returned no content for this call]";

function truncationNote(cap: number): string {
  return (
    `\n\n[Tool output was cut at ${cap} characters; the tail is not shown. Narrow the ` +
    "request, or use pagination or filtering when this server provides it, and tell the " +
    "user when a conclusion rests on the partial text.]"
  );
}

/** Keep the existing text budget without splitting a surrogate pair. */
function clampToolOutput(text: string): string {
  if (text === "") return NO_CONTENT_NOTE;
  if (text.length <= MAX_TOOL_OUTPUT_CHARS) return text;
  let end = MAX_TOOL_OUTPUT_CHARS;
  const before = text.charCodeAt(end - 1);
  const at = text.charCodeAt(end);
  if (before >= 0xd800 && before <= 0xdbff && at >= 0xdc00 && at <= 0xdfff) end -= 1;
  return text.slice(0, end) + truncationNote(MAX_TOOL_OUTPUT_CHARS);
}

/** Preserve screenshot blocks separately from text so providers can inspect them. */
export function mapMcpResult(result: McpCallResult): ToolResult {
  const texts: string[] = [];
  const images: ToolImage[] = [];
  for (const raw of Array.isArray(result.content) ? result.content : []) {
    if (!raw || typeof raw !== "object") continue;
    const part = raw as { type?: unknown; text?: unknown; data?: unknown; mimeType?: unknown };
    if (typeof part.text === "string" && part.text) texts.push(part.text);
    if (part.type === "image" && typeof part.data === "string" && part.data.length > 0 &&
      typeof part.mimeType === "string" && part.mimeType.startsWith("image/")) {
      images.push({ data: part.data, mediaType: part.mimeType });
    }
  }
  const text = texts.join("\n");
  return {
    content: !text && images.length ? "[The server returned an image]" : clampToolOutput(text),
    ...(images.length ? { images } : {}),
    isError: result.isError === true,
  };
}
