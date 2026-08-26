// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { subscribeSidebarSessionStatus } from "./sidebarSessionStatus";
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
  it("emits running before send resolves, then transitions on permission, done, and error", async () => {
    let resolveSend: ((value: { messageId: string }) => void) | undefined;
    apiMock.listMessages.mockResolvedValue([]);
    apiMock.sendMessage.mockReturnValue(new Promise<{ messageId: string }>((resolve) => { resolveSend = resolve; }));
    const statuses: string[] = [];
    const off = subscribeSidebarSessionStatus((event) => statuses.push(event.type));
    const { result } = renderHook(() => useChatStream({ activeId: "session", ensureSession: async () => "session", showError: vi.fn(), t: (key) => key }));

    act(() => { void result.current.send("hello"); });
    expect(statuses).toEqual(["started"]);
    resolveSend?.({ messageId: "assistant" });
    await waitFor(() => expect(result.current.streaming).toBe(true));
    const permission = (apiMock.onChatPermission.mock.calls as unknown as Array<[(event: { sessionId: string; messageId: string; requestId: string; toolName: string; args: Record<string, unknown>; resource: { kind: string; action: string; scope: string } }) => void]>)[0][0];
    const done = (apiMock.onChatDone.mock.calls as unknown as Array<[(event: { sessionId: string; messageId: string }) => void]>)[0][0];
    act(() => { permission({ sessionId: "session", messageId: "assistant", requestId: "p", toolName: "x", args: {}, resource: { kind: "x", action: "x", scope: "x" } }); done({ sessionId: "session", messageId: "assistant" }); });
    expect(statuses).toEqual(["started", "permission", "done"]);
    off();
  });

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
