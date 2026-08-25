import { describe, expect, it } from "vitest";
import { toSdkMessages } from "../src/index";

const messages = [
  {
    role: "assistant" as const,
    parts: [
      { type: "thinking" as const, text: "private" },
      { type: "text" as const, text: "I will run it." },
      { type: "toolCall" as const, id: "call-1", toolName: "shell", args: { command: "pwd" } },
    ],
  },
  {
    role: "user" as const,
    parts: [
      { type: "toolResult" as const, toolCallId: "call-1", content: "/workspace" },
      { type: "text" as const, text: "Continue." },
    ],
  },
];

describe("toSdkMessages", () => {
  it("maps assistant calls and user tool results without replaying thinking", () => {
    expect(toSdkMessages(messages)).toEqual([
      {
        role: "assistant",
        content: [
          { type: "text", text: "I will run it." },
          { type: "tool-call", toolCallId: "call-1", toolName: "shell", input: { command: "pwd" } },
        ],
      },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "call-1",
            toolName: "shell",
            output: { type: "text", value: "/workspace" },
          },
        ],
      },
      { role: "user", content: "Continue." },
    ]);
  });
});
