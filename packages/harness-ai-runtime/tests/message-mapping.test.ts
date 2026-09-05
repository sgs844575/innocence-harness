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
  it("maps assistant calls and user tool results without replaying thinking", async () => {
    expect(await toSdkMessages(messages)).toEqual([
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
            output: {
              type: "text",
              value: "Tool call status: succeeded\nTool output:\n/workspace",
            },
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

    it("delivers tool images as a synthetic user message right after the tool message", async () => {
      const mapped = await toSdkMessages(
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

    it("groups multiple images from one turn into a single user message", async () => {
      const mapped = await toSdkMessages(
        historyWithImages([
          { mediaType: "image/jpeg", data: "AAA" },
          { mediaType: "image/png", data: "BBB" },
        ]),
      );
      const content = mapped[2].content as Array<Record<string, unknown>>;
      expect(content).toHaveLength(3);
      expect(content[1]).toMatchObject({ type: "image", image: "BBB", mediaType: "image/png" });
    });

    it("adds no synthetic message when the tool result has no images", async () => {
      const mapped = await toSdkMessages(historyWithImages(undefined));
      expect(mapped).toHaveLength(2);
      expect(mapped[1]).toMatchObject({ role: "tool" });
    });

    it("keeps error results as error-text while still delivering images", async () => {
      const mapped = await toSdkMessages([
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
      expect(toolContent[0].output).toEqual({
        type: "error-text",
        value: "Tool call status: failed\nFailure reason:\npartial failure",
      });
      expect(mapped[2].role).toBe("user");
    });
  });

  // 附件（规格 §8）：文本与附件表示保持 canonical 顺序；无解析器时显式
  // 省略注记（不静默丢引用）；无附件路径保持纯字符串请求体。
  describe("attachment parts", () => {
    const ref = (n: string, mediaType = "image/png") => ({
      key: `sha256:${n.padStart(64, "0")}`,
      mediaType,
      byteLength: 10,
    });
    const imageAttachment = {
      type: "attachment" as const,
      name: "shot.png",
      source: ref("1"),
      representations: [{ kind: "image" as const, content: ref("2") }],
    };
    const textAttachment = {
      type: "attachment" as const,
      name: "notes.md",
      source: ref("3", "text/plain"),
      representations: [{ kind: "text" as const, content: ref("4", "text/plain") }],
    };

    it("resolver pieces interleave with text in canonical order", async () => {
      const mapped = await toSdkMessages(
        [
          {
            role: "user" as const,
            parts: [
              { type: "text" as const, text: "先看截图" },
              imageAttachment,
              { type: "text" as const, text: "再读笔记" },
              textAttachment,
            ],
          },
        ],
        async (part) =>
          part.representations[0]!.kind === "image"
            ? [{ type: "image" as const, image: "SU1H", mediaType: "image/png" }]
            : [{ type: "text" as const, text: "笔记正文" }],
      );
      expect(mapped).toEqual([
        {
          role: "user",
          content: [
            { type: "text", text: "先看截图" },
            { type: "image", image: "SU1H", mediaType: "image/png" },
            { type: "text", text: "再读笔记" },
            { type: "text", text: "笔记正文" },
          ],
        },
      ]);
    });

    it("without a resolver attachments become explicit omission notes", async () => {
      const mapped = await toSdkMessages([
        { role: "user" as const, parts: [imageAttachment, { type: "text" as const, text: "看图" }] },
      ]);
      expect(mapped).toEqual([
        {
          role: "user",
          content: [
            { type: "text", text: `[Attachment "shot.png" is not included in this request.]` },
            { type: "text", text: "看图" },
          ],
        },
      ]);
    });

    it("attachment-only user turn maps to a pure image message", async () => {
      const mapped = await toSdkMessages(
        [{ role: "user" as const, parts: [imageAttachment] }],
        async () => [{ type: "image" as const, image: "SU1H", mediaType: "image/png" }],
      );
      expect(mapped).toEqual([
        { role: "user", content: [{ type: "image", image: "SU1H", mediaType: "image/png" }] },
      ]);
    });

    it("text-only history keeps the plain string content shape (cache-prefix stability)", async () => {
      const mapped = await toSdkMessages([
        { role: "user" as const, parts: [{ type: "text" as const, text: "普通消息" }] },
      ]);
      expect(mapped).toEqual([{ role: "user", content: "普通消息" }]);
    });
  });
});
