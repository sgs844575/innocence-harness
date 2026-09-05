import { describe, expect, it } from "vitest";
import { generateText } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import type { Message } from "@innocenceharness/harness-providers";
import { toSdkMessages } from "../src/message-mapping";

describe("incomplete tool history replay", () => {
  it.each([false, true])("repairs missing results before a continuation: %s", async (continueTurn) => {
    const history: Message[] = [{ role: "assistant", parts: [
      { type: "text", text: "Checking." },
      { type: "toolCall", id: "missing", toolName: "inspect", args: {} },
      { type: "toolCall", id: "done", toolName: "inspect", args: {} },
    ] }, { role: "user", parts: [
      { type: "toolResult", toolCallId: "done", content: "Actual output" },
    ] }];
    if (continueTurn) history.push({ role: "user", parts: [{ type: "text", text: "Continue." }] });
    const snapshot = structuredClone(history);
    const mapped = await toSdkMessages(history);
    expect(mapped[1]).toMatchObject({ role: "tool", content: [{
      toolCallId: "missing", toolName: "inspect",
      output: { type: "error-text", value: expect.stringContaining("Execution status is unknown") },
    }] });
    expect(mapped[2]).toMatchObject({ role: "tool", content: [{
      toolCallId: "done", output: { type: "text", value: expect.stringContaining("Actual output") },
    }] });
    const model = new MockLanguageModelV3({ doGenerate: {
      content: [{ type: "text", text: "Resumed." }],
      finishReason: { unified: "stop", raw: "stop" },
      usage: {
        inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
        outputTokens: { total: 1, text: 1, reasoning: 0 },
      },
      warnings: [],
    } });
    await generateText({ model, messages: mapped });
    expect(model.doGenerateCalls).toHaveLength(1);
    expect(history).toEqual(snapshot);
    expect(await toSdkMessages(history)).toEqual(mapped);
  });

  it("preserves results recorded in separate messages without adding placeholders", async () => {
    const mapped = await toSdkMessages([
      { role: "assistant", parts: [
        { type: "toolCall", id: "a", toolName: "inspect", args: {} },
        { type: "toolCall", id: "b", toolName: "inspect", args: {} },
      ] },
      { role: "user", parts: [{ type: "toolResult", toolCallId: "a", content: "A" }] },
      { role: "user", parts: [{ type: "toolResult", toolCallId: "b", content: "B", isError: true }] },
    ]);
    expect(mapped).toHaveLength(3);
    expect(JSON.stringify(mapped)).not.toContain("Execution status is unknown");
  });
});
