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

import { createRuntimeHooks, cancelPendingAsks, type PendingPermissionRegistry } from "./runtimeHooks";

describe("runtime completion bridge", () => {
  it("cancels pending permission asks by session and resolves them as deny", async () => {
    const pending: PendingPermissionRegistry = new Map();
    const hooks = createRuntimeHooks(pending);
    const ask = {
      requestId: "p1",
      call: { toolName: "Write", args: {}, resource: { kind: "path", action: "write", scope: "x" } },
    } as never;
    const result = hooks.askPermission("session-a", "message", ask);
    expect(pending.get("p1")?.sessionId).toBe("session-a");
    cancelPendingAsks(pending, "session-a");
    await expect(result).resolves.toBe("deny");
    expect(pending).toHaveLength(0);
  });

  it("cancelling a stopped session denies the ask before a tool can execute", async () => {
    const pending: PendingPermissionRegistry = new Map();
    const hooks = createRuntimeHooks(pending);
    const ask = {
      requestId: "p-stop",
      call: { toolName: "Write", args: {}, resource: { kind: "path", action: "write", scope: "x" } },
    } as never;
    const decision = hooks.askPermission("stopped-session", "message", ask);
    cancelPendingAsks(pending, "stopped-session");
    let toolExecuted = false;
    if (await decision === "allow") toolExecuted = true;
    expect(toolExecuted).toBe(false);
  });
  it("keeps another session's pending permission unresolved when cancelling one session", async () => {
    const pending: PendingPermissionRegistry = new Map();
    const hooks = createRuntimeHooks(pending);
    const ask = (requestId: string) => ({
      requestId,
      call: { toolName: "Write", args: {}, resource: { kind: "path", action: "write", scope: requestId } },
    }) as never;
    const first = hooks.askPermission("session-a", "message", ask("a"));
    const second = hooks.askPermission("session-b", "message", ask("b"));
    cancelPendingAsks(pending, "session-a");
    await expect(first).resolves.toBe("deny");
    expect(pending.has("b")).toBe(true);
    cancelPendingAsks(pending, "session-b");
    await expect(second).resolves.toBe("deny");
  });

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
