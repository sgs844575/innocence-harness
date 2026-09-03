// One-line human summaries of subagent tool activity. The child session's
// raw args stay inside the child; the spawner projects them onto these
// compact titles (and bounded result excerpts) before emitting lifecycle
// events, so panels can render detail without shipping full payloads.
// Rules deliberately mirror the webview timeline's tool-row titles.

/** Result excerpts are capped so lifecycle projections stay lightweight. */
export const TOOL_RESULT_EXCERPT_LIMIT = 2000;

/** Per-value cap of the bounded args projection (lifecycle call payloads). */
export const TOOL_ARG_VALUE_LIMIT = 8000;

/** Titles are single-line; longer argument values are clipped. */
const TITLE_LIMIT = 120;

function clipOneLine(value: string): string {
  const firstLine = value.split("\n", 1)[0] ?? "";
  return firstLine.length > TITLE_LIMIT ? `${firstLine.slice(0, TITLE_LIMIT)}…` : firstLine;
}

function str(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];
  return typeof value === "string" && value !== "" ? value : undefined;
}

function basenameOf(rawPath: string): string {
  const segments = rawPath.replace(/\\/g, "/").split("/").filter(Boolean);
  return segments.pop() ?? rawPath;
}

/**
 * Derives the activity title for a tool call from its args: file name for
 * file tools, the pattern for search tools, the command head for shells,
 * the URL for fetch-style tools; other tools fall back to undefined.
 */
export function summarizeToolTitle(name: string, args: Record<string, unknown> | undefined): string | undefined {
  if (!args) return undefined;
  const lower = name.toLowerCase();
  const filePath = str(args, "file_path") ?? str(args, "path");
  if (filePath) return basenameOf(filePath);
  const pattern = str(args, "pattern") ?? str(args, "query");
  if (pattern) return clipOneLine(pattern);
  const command = str(args, "command");
  if (command) return clipOneLine(command);
  const url = str(args, "url");
  if (url) return clipOneLine(url);
  if (Array.isArray(args.todos)) {
    // Checklist tools: surface the in-progress (or first) item.
    const current =
      (args.todos as { status?: unknown; content?: unknown }[]).find((todo) => todo?.status === "in_progress") ??
      (args.todos as { content?: unknown }[])[0];
    const content = current && typeof current.content === "string" ? current.content : undefined;
    if (content) return clipOneLine(content);
  }
  const description = str(args, "description");
  if (description && (lower.includes("task") || lower.includes("agent") || lower.includes("todo"))) {
    return clipOneLine(description);
  }
  return undefined;
}

/** Bounds a tool result excerpt (head kept, ellipsis marks the cut). */
export function clipToolResult(result: string | undefined): string | undefined {
  if (result === undefined || result === "") return undefined;
  return result.length > TOOL_RESULT_EXCERPT_LIMIT
    ? `${result.slice(0, TOOL_RESULT_EXCERPT_LIMIT)}…`
    : result;
}

/**
 * Bounded args projection for lifecycle events: a shallow copy whose string
 * values are capped at {@link TOOL_ARG_VALUE_LIMIT} (head kept, ellipsis
 * marks the cut); non-string values pass through unchanged. This is the one
 * place raw child args may cross into a lifecycle payload — hosts replay
 * them through the main timeline's tool-row format, and the per-value cap
 * keeps that payload bounded.
 */
export function clipToolArgs(args: Record<string, unknown>): Record<string, unknown> {
  const clipped: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    clipped[key] =
      typeof value === "string" && value.length > TOOL_ARG_VALUE_LIMIT
        ? `${value.slice(0, TOOL_ARG_VALUE_LIMIT)}…`
        : value;
  }
  return clipped;
}
