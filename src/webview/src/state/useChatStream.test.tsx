// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { subscribeSidebarSessionStatus, type SidebarSessionStatusEvent } from "./sidebarSessionStatus";
import type { ChatCompletionMetadata, ChatMessage } from "../../../shared/ipc";

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
  apiMock.listMessages.mockReset().mockResolvedValue([]);
  apiMock.respondChatPermission.mockReset().mockResolvedValue(undefined);
  for (const listener of [apiMock.onChatPermission, apiMock.onChatDelta, apiMock.onChatDone, apiMock.onChatError, apiMock.onChatTool, apiMock.onChatThinking]) {
    listener.mockReset().mockReturnValue(() => {});
  }
});

function permissionCallback() {
  return (apiMock.onChatPermission.mock.calls as unknown as Array<[(event: {
    sessionId: string;
    messageId: string;
    requestId: string;
    toolName: string;
    args: Record<string, unknown>;
    resource: { kind: string; action: string; scope: string };
  }) => void]>)[0][0];
}

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
    const permission = permissionCallback();
    const done = (apiMock.onChatDone.mock.calls as unknown as Array<[(event: { sessionId: string; messageId: string }) => void]>)[0][0];
    act(() => { permission({ sessionId: "session", messageId: "assistant", requestId: "p", toolName: "x", args: {}, resource: { kind: "x", action: "x", scope: "x" } }); done({ sessionId: "session", messageId: "assistant" }); });
    expect(statuses).toEqual(["started", "permission", "done"]);
    off();
  });

  it("emits permission resolution so the canonical activity resumes running after allow", async () => {
    apiMock.listMessages.mockResolvedValue([{ id: "assistant", role: "assistant", parts: [], createdAt: 1, streaming: true }]);
    const events: SidebarSessionStatusEvent[] = [];
    const off = subscribeSidebarSessionStatus((event) => events.push(event));
    const { result } = renderHook(() => useChatStream({ activeId: "session", ensureSession: async () => "session", showError: vi.fn(), t: (key) => key }));
    await waitFor(() => expect(result.current.messages).toHaveLength(1));
    const permission = permissionCallback();
    act(() => permission({ sessionId: "session", messageId: "assistant", requestId: "p", toolName: "x", args: {}, resource: { kind: "x", action: "x", scope: "x" } }));
    await act(async () => { await result.current.respondPermission("p", "allow"); });
    expect(events).toContainEqual({ type: "permission-resolved", sessionId: "session", decision: "allow" });
    off();
  });

  it("clears a pending permission when switching away from its session", async () => {
    apiMock.listMessages.mockResolvedValue([]);
    const events: SidebarSessionStatusEvent[] = [];
    const off = subscribeSidebarSessionStatus((event) => events.push(event));
    const { result, rerender } = renderHook(({ activeId }) => useChatStream({ activeId, ensureSession: async () => activeId ?? "A", showError: vi.fn(), t: (key) => key }), {
      initialProps: { activeId: "A" as string | null },
    });
    await waitFor(() => expect(apiMock.listMessages).toHaveBeenCalledWith("A"));
    const permission = permissionCallback();
    act(() => permission({ sessionId: "A", messageId: "assistant-a", requestId: "permission-a", toolName: "x", args: {}, resource: { kind: "x", action: "x", scope: "x" } }));
    expect(result.current.permission?.requestId).toBe("permission-a");
    rerender({ activeId: "B" });
    await waitFor(() => expect(result.current.permission).toBeNull());
    rerender({ activeId: "A" });
    await waitFor(() => expect(result.current.permission?.requestId).toBe("permission-a"));
    await act(async () => { await result.current.respondPermission("permission-a", "allow"); });

    expect(apiMock.respondChatPermission).toHaveBeenCalledWith("permission-a", "allow");
    expect(events).toContainEqual({ type: "permission-resolved", sessionId: "A", decision: "allow" });
    off();
  });

  it("clears a denied pending permission when switching away from its session", async () => {
    apiMock.listMessages.mockResolvedValue([]);
    const events: SidebarSessionStatusEvent[] = [];
    const off = subscribeSidebarSessionStatus((event) => events.push(event));
    const { result, rerender } = renderHook(({ activeId }) => useChatStream({ activeId, ensureSession: async () => activeId ?? "A", showError: vi.fn(), t: (key) => key }), {
      initialProps: { activeId: "A" as string | null },
    });
    await waitFor(() => expect(apiMock.listMessages).toHaveBeenCalledWith("A"));
    const permission = permissionCallback();
    act(() => permission({ sessionId: "A", messageId: "assistant-a", requestId: "permission-a", toolName: "x", args: {}, resource: { kind: "x", action: "x", scope: "x" } }));
    expect(result.current.permission?.requestId).toBe("permission-a");
    rerender({ activeId: "B" });
    await waitFor(() => expect(result.current.permission).toBeNull());
    rerender({ activeId: "A" });
    await waitFor(() => expect(result.current.permission?.requestId).toBe("permission-a"));
    await act(async () => { await result.current.respondPermission("permission-a", "deny"); });

    expect(apiMock.respondChatPermission).toHaveBeenCalledWith("permission-a", "deny");
    expect(events).toContainEqual({ type: "permission-resolved", sessionId: "A", decision: "deny" });
    off();
  });

  it("waits for permission IPC success before clearing the card", async () => {
    apiMock.listMessages.mockResolvedValue([]);
    let resolveResponse: (() => void) | undefined;
    apiMock.respondChatPermission.mockReturnValue(new Promise<void>((resolve) => { resolveResponse = resolve; }));
    const events: SidebarSessionStatusEvent[] = [];
    const off = subscribeSidebarSessionStatus((event) => events.push(event));
    const { result } = renderHook(() => useChatStream({ activeId: "session", ensureSession: async () => "session", showError: vi.fn(), t: (key) => key }));
    const permission = permissionCallback();
    act(() => permission({ sessionId: "session", messageId: "assistant", requestId: "p", toolName: "x", args: {}, resource: { kind: "x", action: "x", scope: "x" } }));

    let response: Promise<void> | undefined;
    act(() => { response = result.current.respondPermission("p", "allowSession"); });
    expect(result.current.permission?.requestId).toBe("p");
    expect(events).not.toContainEqual({ type: "permission-resolved", sessionId: "session", decision: "allowSession" });

    await act(async () => {
      resolveResponse?.();
      await response;
    });
    expect(result.current.permission).toBeNull();
    expect(events).toContainEqual({ type: "permission-resolved", sessionId: "session", decision: "allowSession" });
    off();
  });

  it("keeps a failed permission response retryable and reports the error", async () => {
    apiMock.listMessages.mockResolvedValue([]);
    apiMock.respondChatPermission
      .mockRejectedValueOnce(new Error("request expired"))
      .mockResolvedValueOnce(undefined);
    const showError = vi.fn();
    const { result } = renderHook(() => useChatStream({ activeId: "session", ensureSession: async () => "session", showError, t: (key) => key }));
    const permission = permissionCallback();
    act(() => permission({ sessionId: "session", messageId: "assistant", requestId: "p", toolName: "x", args: {}, resource: { kind: "x", action: "x", scope: "x" } }));

    await act(async () => { await result.current.respondPermission("p", "allowSession"); });
    expect(result.current.permission?.requestId).toBe("p");
    expect(showError).toHaveBeenCalledWith("error.permissionResponse");

    await act(async () => { await result.current.respondPermission("p", "allowSession"); });
    expect(result.current.permission).toBeNull();
    expect(apiMock.respondChatPermission).toHaveBeenCalledTimes(2);
  });

  it("buffers a permission emitted before the first active session is selected", async () => {
    apiMock.listMessages.mockResolvedValue([]);
    const { result, rerender } = renderHook(({ activeId }) => useChatStream({ activeId, ensureSession: async () => activeId ?? "session", showError: vi.fn(), t: (key) => key }), {
      initialProps: { activeId: null as string | null },
    });
    const permission = permissionCallback();
    const event = { sessionId: "session", messageId: "assistant", requestId: "p", toolName: "x", args: {}, resource: { kind: "x", action: "x", scope: "x" } };

    act(() => permission(event));
    expect(result.current.permission).toBeNull();
    rerender({ activeId: "session" });
    await waitFor(() => expect(result.current.permission?.requestId).toBe("p"));
    expect(apiMock.onChatPermission).toHaveBeenCalledTimes(1);
  });

  it("keeps buffered permissions isolated by session while switching from null", async () => {
    apiMock.listMessages.mockResolvedValue([]);
    const { result, rerender } = renderHook(({ activeId }) => useChatStream({ activeId, ensureSession: async () => activeId, showError: vi.fn(), t: (key) => key }), {
      initialProps: { activeId: null as string | null },
    });
    const permission = permissionCallback();
    const event = (sessionId: string, requestId: string) => ({ sessionId, messageId: `message-${sessionId}`, requestId, toolName: "Write", args: {}, resource: { kind: "path", action: "write", scope: requestId } });

    act(() => {
      permission(event("A", "permission-a"));
      permission(event("B", "permission-b"));
    });
    rerender({ activeId: "B" });
    await waitFor(() => expect(result.current.permission?.requestId).toBe("permission-b"));
    await act(async () => { await result.current.respondPermission("permission-b", "deny"); });
    rerender({ activeId: "A" });
    await waitFor(() => expect(result.current.permission?.requestId).toBe("permission-a"));
    expect(result.current.permission?.sessionId).toBe("A");
  });

  it("does not let a stale message load overwrite the newly selected session", async () => {
    let resolveA: ((messages: ChatMessage[]) => void) | undefined;
    let resolveB: ((messages: ChatMessage[]) => void) | undefined;
    apiMock.listMessages.mockImplementation((sessionId: string) => new Promise<ChatMessage[]>((resolve) => {
      if (sessionId === "A") resolveA = resolve;
      else resolveB = resolve;
    }));
    const { result, rerender } = renderHook(({ activeId }) => useChatStream({ activeId, ensureSession: async () => activeId, showError: vi.fn(), t: (key) => key }), {
      initialProps: { activeId: "A" as string | null },
    });
    rerender({ activeId: "B" });
    const bMessage: ChatMessage = { id: "b", role: "assistant", parts: [], createdAt: 2 };
    const aMessage: ChatMessage = { id: "a", role: "assistant", parts: [], createdAt: 1 };
    await act(async () => {
      resolveB?.([bMessage]);
      await Promise.resolve();
      resolveA?.([aMessage]);
      await Promise.resolve();
    });
    expect(result.current.messages).toEqual([bMessage]);
  });

  it("queues permission events from inactive sessions and restores each session's own item", async () => {
    apiMock.listMessages.mockResolvedValue([]);
    const { result, rerender } = renderHook(({ activeId }) => useChatStream({ activeId, ensureSession: async () => activeId, showError: vi.fn(), t: (key) => key }), {
      initialProps: { activeId: "A" as string | null },
    });
    const permission = permissionCallback();
    const event = (sessionId: string, requestId: string) => ({ sessionId, messageId: `message-${sessionId}`, requestId, toolName: "Write", args: {}, resource: { kind: "path", action: "write", scope: requestId } });

    act(() => permission(event("B", "permission-b")));
    expect(result.current.permission).toBeNull();
    rerender({ activeId: "B" });
    await waitFor(() => expect(result.current.permission?.requestId).toBe("permission-b"));
    rerender({ activeId: "A" });
    expect(result.current.permission).toBeNull();
    rerender({ activeId: "B" });
    await waitFor(() => expect(result.current.permission?.requestId).toBe("permission-b"));
  });

  it("keeps a concurrent permission card when another message completes", async () => {
    apiMock.listMessages.mockResolvedValue([]);
    const { result } = renderHook(() => useChatStream({ activeId: "session", ensureSession: async () => "session", showError: vi.fn(), t: (key) => key }));
    const permission = permissionCallback();
    const done = (apiMock.onChatDone.mock.calls as unknown as Array<[(event: { sessionId: string; messageId: string }) => void]>)[0][0];
    const event = (messageId: string, requestId: string) => ({ sessionId: "session", messageId, requestId, toolName: "Write", args: {}, resource: { kind: "path", action: "write", scope: requestId } });

    act(() => {
      permission(event("message-1", "permission-1"));
      permission(event("message-2", "permission-2"));
    });
    expect(result.current.permission?.requestId).toBe("permission-1");
    act(() => done({ sessionId: "session", messageId: "message-1" }));
    await waitFor(() => expect(result.current.permission?.requestId).toBe("permission-2"));
  });

  it("does not append a send result after the active session generation changes", async () => {
    apiMock.listMessages.mockResolvedValue([]);
    let resolveTask: (() => void) | undefined;
    apiMock.sendMessage.mockResolvedValue({ messageId: "old-assistant" });
    const { result, rerender } = renderHook(({ activeId }) => useChatStream({
      activeId,
      ensureSession: async () => activeId,
      ensureTask: async () => new Promise<void>((resolve) => { resolveTask = resolve; }),
      showError: vi.fn(),
      t: (key) => key,
    }), { initialProps: { activeId: "A" as string | null } });

    act(() => { void result.current.send("old message"); });
    rerender({ activeId: "B" });
    resolveTask?.();
    await waitFor(() => expect(apiMock.sendMessage).not.toHaveBeenCalled());
    expect(result.current.messages).toEqual([]);
    expect(apiMock.stopMessage).not.toHaveBeenCalled();
  });

  it("stops but does not append a send result resolved after switching sessions", async () => {
    apiMock.listMessages.mockResolvedValue([]);
    let resolveSend: ((value: { messageId: string }) => void) | undefined;
    apiMock.sendMessage.mockReturnValue(new Promise<{ messageId: string }>((resolve) => { resolveSend = resolve; }));
    const { result, rerender } = renderHook(({ activeId }) => useChatStream({
      activeId,
      ensureSession: async () => activeId,
      showError: vi.fn(),
      t: (key) => key,
    }), { initialProps: { activeId: "A" as string | null } });

    act(() => { void result.current.send("old message"); });
    await waitFor(() => expect(apiMock.sendMessage).toHaveBeenCalledWith("A", "old message"));
    rerender({ activeId: "B" });
    await act(async () => {
      resolveSend?.({ messageId: "old-assistant" });
      await Promise.resolve();
    });

    expect(result.current.messages).toEqual([]);
    expect(apiMock.stopMessage).toHaveBeenCalledWith("A", "old-assistant");
    expect(result.current.streaming).toBe(false);
  });
  it("sends the first landing message through the session created by ensureSession", async () => {
    apiMock.listMessages.mockResolvedValue([]);
    apiMock.sendMessage.mockResolvedValue({ messageId: "assistant" });
    const { result } = renderHook(() => useChatStream({
      activeId: null,
      ensureSession: async () => "created-session",
      showError: vi.fn(),
      t: (key) => key,
    }));

    await act(async () => { await result.current.send("first message"); });

    expect(apiMock.sendMessage).toHaveBeenCalledWith("created-session", "first message");
    expect(result.current.messages).toHaveLength(2);
  });


  it("keeps the first landing message when session activation renders before send resumes", async () => {
    apiMock.listMessages.mockResolvedValue([]);
    apiMock.sendMessage.mockResolvedValue({ messageId: "assistant" });
    let resolveSession: ((sessionId: string) => void) | undefined;
    const { result, rerender } = renderHook(({ activeId }) => useChatStream({
      activeId,
      ensureSession: () => new Promise<string>((resolve) => { resolveSession = resolve; }),
      showError: vi.fn(),
      t: (key) => key,
    }), { initialProps: { activeId: null as string | null } });

    let sending: Promise<void> | undefined;
    act(() => { sending = result.current.send("first message"); });
    resolveSession?.("created-session");
    rerender({ activeId: "created-session" });
    await act(async () => { await sending; });

    expect(apiMock.sendMessage).toHaveBeenCalledWith("created-session", "first message");
    expect(result.current.messages).toHaveLength(2);
  });
  it("keeps streaming state isolated when switching sessions", async () => {
    apiMock.listMessages.mockResolvedValue([]);
    apiMock.sendMessage.mockResolvedValue({ messageId: "assistant-a" });
    const { result, rerender } = renderHook(({ activeId }) => useChatStream({
      activeId,
      ensureSession: async () => activeId,
      showError: vi.fn(),
      t: (key) => key,
    }), { initialProps: { activeId: "A" as string | null } });

    await act(async () => { await result.current.send("message"); });
    expect(result.current.streaming).toBe(true);
    rerender({ activeId: "B" });
    expect(result.current.streaming).toBe(false);
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
    const { result } = renderHook(() => useChatStream({
      activeId: "session",
      ensureSession: async () => "session",
      showError: vi.fn(),
      t: (key) => key,
    }));
    await waitFor(() => expect(result.current.messages).toHaveLength(1));

    const done = (apiMock.onChatDone.mock.calls as unknown as Array<[(event: { sessionId: string; messageId: string; completion?: ChatCompletionMetadata }) => void]>)[0][0];
    const error = (apiMock.onChatError.mock.calls as unknown as Array<[(event: { sessionId: string; messageId: string; error: string }) => void]>)[0][0];
    act(() => {
      done({ sessionId: "session", messageId: "assistant", completion });
      error({ sessionId: "session", messageId: "assistant", error: "Model request failed" });
    });

    expect(result.current.messages[0]).toMatchObject({ streaming: false, completion });
    expect(result.current.messages[0].parts).toContainEqual({ type: "text", text: "\n\n> ⚠️ Model request failed" });
  });
});
