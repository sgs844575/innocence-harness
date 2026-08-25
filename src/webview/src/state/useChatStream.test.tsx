// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChatCompletionMetadata } from "../../../shared/ipc";

const apiMock = vi.hoisted(() => ({
  listMessages: vi.fn(),
  onChatPermission: vi.fn(() => () => {}),
  onChatDelta: vi.fn(() => () => {}),
  onChatDone: vi.fn(() => () => {}),
  onChatError: vi.fn(() => () => {}),
  onChatTool: vi.fn(() => () => {}),
  onChatThinking: vi.fn(() => () => {}),
  sendMessage: vi.fn(),
  stopMessage: vi.fn(),
  respondChatPermission: vi.fn(),
}));

vi.mock("../lib/ipc", () => ({ api: apiMock }));

import { useChatStream } from "./useChatStream";

afterEach(() => {
  vi.clearAllMocks();
});

describe("useChatStream completion metadata", () => {
  it("keeps the fatal completion when the host also reports its error text", async () => {
    const completion: ChatCompletionMetadata = {
      providerId: "provider-safe",
      modelId: "model-safe",
      finishReason: "error",
      usage: { inputTokens: 3, outputTokens: 5, totalTokens: 8 },
      aborted: false,
      responseId: "resp_opaque",
    };
    apiMock.listMessages.mockResolvedValue([
      { id: "assistant", role: "assistant", parts: [], createdAt: 1, streaming: true },
    ]);
    const { result } = renderHook(() =>
      useChatStream({
        activeId: "session",
        ensureSession: async () => "session",
        showError: vi.fn(),
        t: (key) => key,
      }),
    );
    await waitFor(() => expect(result.current.messages).toHaveLength(1));

    const done = (apiMock.onChatDone.mock.calls as unknown as Array<[(event: {
      sessionId: string;
      messageId: string;
      completion?: ChatCompletionMetadata;
    }) => void]>)[0][0];
    const error = (apiMock.onChatError.mock.calls as unknown as Array<[(event: {
      sessionId: string;
      messageId: string;
      error: string;
    }) => void]>)[0][0];
    act(() => {
      done({ sessionId: "session", messageId: "assistant", completion });
      error({ sessionId: "session", messageId: "assistant", error: "Model request failed" });
    });

    expect(result.current.messages[0]).toMatchObject({ streaming: false, completion });
    expect(result.current.messages[0].parts).toContainEqual({
      type: "text",
      text: "\n\n> ⚠️ Model request failed",
    });
  });
});
