import { describe, expect, it, vi } from "vitest";
import { IPC, type ChatCompletionMetadata, type ChatMessage } from "../shared/ipc";

const state = vi.hoisted(() => {
  const messages = new Map<string, ChatMessage>([
    ["assistant", { id: "assistant", role: "assistant", parts: [], createdAt: 1, streaming: true }],
  ]);
  return {
    messages,
    send: vi.fn(),
    updateMessage: vi.fn((_: string, messageId: string, patch: (message: ChatMessage) => void) => {
      patch(messages.get(messageId)!);
    }),
  };
});

vi.mock("./sessions", () => ({ updateMessage: state.updateMessage }));
vi.mock("./appWindow", () => ({
  getMainWindow: () => ({ isDestroyed: () => false, webContents: { send: state.send } }),
}));
vi.mock("./logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { createRuntimeHooks } from "./runtimeHooks";

describe("runtime completion bridge", () => {
  it("persists and emits the terminal completion supplied by a fatal model turn", () => {
    const completion: ChatCompletionMetadata = {
      providerId: "provider-safe",
      modelId: "model-safe",
      finishReason: "error",
      usage: { inputTokens: 3, outputTokens: 5, totalTokens: 8 },
      aborted: false,
      responseId: "resp_opaque",
    };
    const hooks = createRuntimeHooks(new Map());

    hooks.onCompleted("session", "assistant", completion);

    expect(state.messages.get("assistant")).toMatchObject({ streaming: false, completion });
    expect(state.send).toHaveBeenCalledWith(IPC.chatDone, {
      sessionId: "session",
      messageId: "assistant",
      completion,
    });
  });
});
