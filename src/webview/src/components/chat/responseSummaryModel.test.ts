import { describe, expect, it } from "vitest";
import type { ChatMessage, MessagePart } from "../../../../shared/ipc";
import { turnSummary } from "./responseSummaryModel";

function edit(id: string, path: string, isError = false): MessagePart[] {
  return [
    { type: "toolCall", id, toolName: "Edit", args: { file_path: path, old_string: "old", new_string: "new\nline" } },
    { type: "toolResult", toolCallId: id, content: "done", isError },
  ];
}
export const completed: ChatMessage = {
  id: "response", role: "assistant", createdAt: 1,
  completion: { finishReason: "stop", aborted: false },
  parts: [
    { type: "text", text: "Working" }, ...edit("one", "src/a.ts"),
    { type: "text", text: "Checking" }, ...edit("two", "src\\a.ts"),
    ...edit("three", "src/b.ts", true), { type: "text", text: "Finished" },
  ],
};

describe("turnSummary", () => {
  it("deduplicates paths across segments and excludes failed changes without hiding failures", () => {
    const summary = turnSummary(completed)!;
    expect(summary.files).toHaveLength(1);
    expect(summary.files[0]).toMatchObject({ path: "src/a.ts", additions: 4, deletions: 2 });
    expect(summary.files[0]!.rows.map((row) => row.id)).toEqual(["one", "two"]);
    expect(summary.hasErrors).toBe(true);
    expect(completed.parts).toHaveLength(9);
  });
  it("leaves streaming, interrupted, failed and unfinished responses uncollapsed", () => {
    expect(turnSummary({ ...completed, streaming: true })).toBeNull();
    expect(turnSummary({ ...completed, completion: undefined })).toBeNull();
    expect(turnSummary({ ...completed, completion: { finishReason: "error", aborted: false } })).toBeNull();
    expect(turnSummary({ ...completed, completion: { finishReason: "stop", aborted: true } })).toBeNull();
    expect(turnSummary({ ...completed, parts: completed.parts.filter((p) => p.type !== "toolResult") })).toBeNull();
  });
  it("does not promote progress text to a conclusion or aggregate a plain answer", () => {
    expect(turnSummary({ ...completed, parts: completed.parts.slice(0, -1) })).toBeNull();
    expect(turnSummary({ ...completed, parts: [{ type: "text", text: "Hello" }] })).toBeNull();
  });
});
