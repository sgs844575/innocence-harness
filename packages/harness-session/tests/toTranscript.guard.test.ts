// 压缩转录护栏：Edit/Write 的 persisted args 现携带正文（用户裁定不再脱敏），
// toTranscript 对工具参数做有界展开，避免把大正文灌进压缩摘要。
import { describe, expect, it } from "vitest";
import { toTranscript, type Message } from "../src/types";

describe("toTranscript bounds persisted tool args", () => {
  it("expands the args summary (compact per tool, bounded per string)", () => {
    const messages: Message[] = [
      {
        role: "assistant",
        parts: [
          {
            type: "toolCall",
            id: "c1",
            toolName: "Write",
            args: {
              path: "src/a.ts",
              content: "export const n = 1;\n",
              contentLength: 20,
              summary: "export const n = 1;",
            },
          },
        ],
      },
    ];
    const transcript = toTranscript(messages);
    expect(transcript).toContain("src/a.ts");
    expect(transcript).toContain("export const n = 1;");
  });

  it("caps a giant persisted body inside the transcript line", () => {
    const giant = "y".repeat(200_000);
    const messages: Message[] = [
      {
        role: "assistant",
        parts: [
          {
            type: "toolCall",
            id: "c1",
            toolName: "Write",
            args: { path: "src/big.ts", content: giant, summary: "…" },
          },
        ],
      },
    ];
    const transcript = toTranscript(messages);
    expect(transcript.length).toBeLessThan(10_000);
  });
});