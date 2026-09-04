import { describe, expect, it } from "vitest";
import type { ChatMessage } from "../../../shared/ipc";
import { callTraceRows } from "./CallTraceDialog";

describe("callTraceRows", () => {
  it("projects model completion and the complete tool invocation", () => {
    const messages: ChatMessage[] = [{
      id: "a1",
      role: "assistant",
      createdAt: 100,
      completion: { finishReason: "stop", aborted: false, modelId: "model-a", usage: { totalTokens: 12 } },
      parts: [
        { type: "toolCall", id: "c1", toolName: "read", args: { secret: "hidden" } },
        { type: "toolResult", toolCallId: "c1", content: "body", isError: false, durationMs: 9 },
      ],
    }];
    const rows = callTraceRows(messages);
    expect(rows.map((row) => [row.kind, row.title, row.detail])).toEqual([
      ["turn", "model-a", "stop · 12 tokens"],
      ["tool", "read", "completed · 9 ms"],
    ]);
    expect(rows[1]).toMatchObject({
      payload: JSON.stringify({
        args: { secret: "hidden" },
        result: { content: "body", isError: false, durationMs: 9 },
      }, null, 2),
    });
  });
});
