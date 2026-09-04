// One-line human summaries of subagent tool activity. The child session's
// raw args stay inside the child; the spawner projects them onto these
// compact titles before emitting lifecycle events so panels can render them.
// Rules deliberately mirror the webview timeline's tool-row titles.

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
