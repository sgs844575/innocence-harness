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

  // 视觉闭环：工具结果携带的图像以紧跟 tool 消息的 user 消息送达
  // （chat-completions 兼容端点的 tool 消息只收文本，user 图像是所有
  // provider 支持的最大公约数路径）。
  describe("tool result images", () => {
    function historyWithImages(images: Array<{ mediaType: string; data: string }> | undefined) {
      return [
        {
          role: "assistant" as const,
          parts: [{ type: "toolCall" as const, id: "c1", toolName: "computer_screenshot", args: {} }],
        },
        {
          role: "user" as const,
          parts: [
            {
              type: "toolResult" as const,
              toolCallId: "c1",
              content: "Screenshot saved to screen.png (1920x1080).",
              ...(images ? { images } : {}),
            },
          ],
        },
      ];
    }

    it("delivers tool images as a synthetic user message right after the tool message", () => {
      const mapped = toSdkMessages(
        historyWithImages([{ mediaType: "image/jpeg", data: "QUJD" }]),
      );
      expect(mapped).toHaveLength(3);
      expect(mapped[1]).toMatchObject({ role: "tool" });
      expect(mapped[2].role).toBe("user");
      const content = mapped[2].content as Array<Record<string, unknown>>;
      expect(content).toHaveLength(2);
      expect(content[0]).toEqual({ type: "image", image: "QUJD", mediaType: "image/jpeg" });
      expect(String(content[1].text)).toContain("tool calls");
    });

    it("groups multiple images from one turn into a single user message", () => {
      const mapped = toSdkMessages(
        historyWithImages([
          { mediaType: "image/jpeg", data: "AAA" },
          { mediaType: "image/png", data: "BBB" },
        ]),
      );
      const content = mapped[2].content as Array<Record<string, unknown>>;
      expect(content).toHaveLength(3);
      expect(content[1]).toMatchObject({ type: "image", image: "BBB", mediaType: "image/png" });
    });

    it("adds no synthetic message when the tool result has no images", () => {
      const mapped = toSdkMessages(historyWithImages(undefined));
      expect(mapped).toHaveLength(2);
      expect(mapped[1]).toMatchObject({ role: "tool" });
    });

    it("keeps error results as error-text while still delivering images", () => {
      const mapped = toSdkMessages([
        { role: "assistant" as const, parts: [{ type: "toolCall" as const, id: "c1", toolName: "T", args: {} }] },
        {
          role: "user" as const,
          parts: [
            {
              type: "toolResult" as const,
              toolCallId: "c1",
              content: "partial failure",
              isError: true,
              images: [{ mediaType: "image/png", data: "WQ==" }],
            },
          ],
        },
      ]);
      const toolContent = mapped[1].content as Array<Record<string, unknown>>;
      expect(toolContent[0].output).toEqual({ type: "error-text", value: "partial failure" });
      expect(mapped[2].role).toBe("user");
    });
  });
});
