import { describe, expect, it, vi } from "vitest";
import type { ContextUsageSnapshot } from "@innocenceharness/harness-context-meter";
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
    updateContextUsage: vi.fn(),
  };
});

vi.mock("./sessions", () => ({
  updateMessage: state.updateMessage,
  updateContextUsage: state.updateContextUsage,
}));
vi.mock("./appWindow", () => ({
  getMainWindow: () => ({ isDestroyed: () => false, webContents: { send: state.send } }),
}));
vi.mock("./logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { createRuntimeHooks, cancelPendingAsks, QUESTION_AUTO_CONTINUE_TIMEOUT_MS, type PendingPermissionRegistry } from "./runtimeHooks";

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

  it("onContextUsage 更新 store 并广播 chat:context", () => {
    // runtime 在钩子前已富化（会话级 cache 累计 + contextWindow）；变量先
    // 落地以携带富化字段，避开字面量的多余属性检查。
    const enriched: ContextUsageSnapshot & { contextWindow?: number } = {
      inputTokens: 200,
      breakdown: { systemPrompt: 60, skills: 10, systemTools: 20, mcpTools: 10, messages: 90, other: 10 },
      cache: { inputTokens: 300, cachedInputTokens: 150 },
      contextWindow: 1000,
    };
    const hooks = createRuntimeHooks(new Map());

    hooks.onContextUsage!("session", enriched);

    expect(state.updateContextUsage).toHaveBeenCalledWith("session", enriched);
    expect(state.send).toHaveBeenCalledWith(IPC.chatContextUsage, {
      sessionId: "session",
      snapshot: expect.objectContaining({ inputTokens: 200, contextWindow: 1000 }),
    });
  });

  it("forwards turn events to the desktop-notify port on the same flow", () => {
    const notify = vi.fn();
    const hooks = createRuntimeHooks(new Map(), notify);
    const completion: ChatCompletionMetadata = {
      finishReason: "stop",
      aborted: false,
    };

    hooks.onCompleted("session", "assistant", completion);
    expect(notify).toHaveBeenCalledWith("completed", "session", { aborted: false });

    hooks.onError("session", "assistant", "boom");
    expect(notify).toHaveBeenCalledWith("failed", "session");

    const ask = {
      requestId: "p-notify",
      call: { toolName: "Write", args: {}, resource: { kind: "path", action: "write", scope: "x" } },
    } as never;
    void hooks.askPermission("session", "assistant", ask);
    expect(notify).toHaveBeenCalledWith("permission", "session");
  });

  it("runs without a notify port (settings surface unwired)", () => {
    const hooks = createRuntimeHooks(new Map());
    const completion: ChatCompletionMetadata = { finishReason: "stop", aborted: true };
    expect(() => hooks.onCompleted("session", "assistant", completion)).not.toThrow();
  });
});

describe("permission ask timeout (questionAutoContinue)", () => {
  const ask = (requestId: string) => ({
    requestId,
    call: { toolName: "Write", args: {}, resource: { kind: "path", action: "write", scope: requestId } },
  }) as never;

  it("auto-continue on: an unanswered ask auto-declines after 5 minutes", async () => {
    vi.useFakeTimers();
    try {
      const pending: PendingPermissionRegistry = new Map();
      const hooks = createRuntimeHooks(pending, undefined, () => true);
      const result = hooks.askPermission("session", "message", ask("p-auto"));
      expect(pending.has("p-auto")).toBe(true);
      // 4:59 仍在等待；到 5:00 自动按拒绝落定，登记清除。
      await vi.advanceTimersByTimeAsync(QUESTION_AUTO_CONTINUE_TIMEOUT_MS - 1);
      expect(pending.has("p-auto")).toBe(true);
      await vi.advanceTimersByTimeAsync(1);
      await expect(result).resolves.toBe("deny");
      expect(pending.size).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("auto-continue off: no timer is armed — the ask waits for the human forever", async () => {
    vi.useFakeTimers();
    try {
      const pending: PendingPermissionRegistry = new Map();
      const hooks = createRuntimeHooks(pending, undefined, () => false);
      const result = hooks.askPermission("session", "message", ask("p-wait"));
      // 一小时也不自动落定（取代旧的固定 10 分钟兜底）。
      await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
      expect(pending.has("p-wait")).toBe(true);
      pending.get("p-wait")!.finish("allow");
      await expect(result).resolves.toBe("allow");
      expect(pending.size).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("absent getter defaults to waiting forever", async () => {
    vi.useFakeTimers();
    try {
      const pending: PendingPermissionRegistry = new Map();
      const hooks = createRuntimeHooks(pending);
      const result = hooks.askPermission("session", "message", ask("p-default"));
      await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
      expect(pending.has("p-default")).toBe(true);
      pending.get("p-default")!.finish("deny");
      await expect(result).resolves.toBe("deny");
    } finally {
      vi.useRealTimers();
    }
  });

  it("cancelPendingAsks still settles an auto-continue ask as deny before the timer", async () => {
    vi.useFakeTimers();
    try {
      const pending: PendingPermissionRegistry = new Map();
      const hooks = createRuntimeHooks(pending, undefined, () => true);
      const result = hooks.askPermission("session", "message", ask("p-cancel"));
      cancelPendingAsks(pending, "session");
      await expect(result).resolves.toBe("deny");
      // 定时器已随 finish 清除：推进时间不会二次落定或抛错。
      await vi.advanceTimersByTimeAsync(QUESTION_AUTO_CONTINUE_TIMEOUT_MS + 1);
      expect(pending.size).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
