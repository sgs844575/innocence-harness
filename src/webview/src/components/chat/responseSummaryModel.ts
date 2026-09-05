import type { ChatMessage } from "../../../../shared/ipc";
import { segmentParts } from "./segmentParts";
import { buildToolRows, type ToolRowModel } from "./toolRows";

export interface SummaryFile {
  path: string;
  rows: ToolRowModel[];
  additions: number;
  deletions: number;
}

/** Project a completed response without changing its durable message parts. */
export function turnSummary(message: ChatMessage) {
  if (message.streaming || message.completion?.aborted || message.completion?.finishReason !== "stop") return null;
  const segments = segmentParts(message.parts);
  const conclusionIndex = segments.reduce((last, segment, index) =>
    segment.kind === "text" && segment.text.trim() !== "" ? index : last, -1);
  if (conclusionIndex < 1 || segments.slice(conclusionIndex + 1).some((segment) => segment.kind === "tools")) return null;
  const rows = buildToolRows(message.parts);
  if (rows.some((row) => row.running)) return null;
  const files = new Map<string, SummaryFile>();
  for (const row of rows) {
    if (row.isError || !row.filePath || !["tool.verb.edit", "tool.verb.write"].includes(row.verbKey)) continue;
    const file = files.get(row.filePath) ?? { path: row.filePath, rows: [], additions: 0, deletions: 0 };
    file.rows.push(row);
    file.additions += row.additions ?? 0;
    file.deletions += row.deletions ?? 0;
    files.set(file.path, file);
  }
  return { conclusionIndex, files: [...files.values()], hasErrors: rows.some((row) => row.isError) };
}
