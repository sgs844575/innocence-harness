// useChatStream — delta/tool/thinking/permission 流式状态（Task 12 从
// App.tsx 拆出）。职责：活动会话的消息列表、流式气泡 id、权限卡片，以及
// 发送/停止/权限应答命令。事件只作用于 activeId 会话（其余忽略）。
import { useCallback, useEffect, useRef, useState } from "react";
import {
  appendText,
  type ChatMessage,
  type ChatPermissionEvent,
  type PermissionChoice,
} from "../../../shared/ipc";
import { api } from "../lib/ipc";
import { emitSidebarSessionStatus } from "./sidebarSessionStatus";

const MAX_PERMISSION_QUEUE = 32;

function isMissingPermissionError(error: unknown): boolean {
  return error instanceof Error && error.message.includes("permission request not found");
}

export interface ChatStreamDeps {
  activeId: string | null;
  /** 落地态首条消息的建会入口（sessionController.ensureSessionForSend）。 */
  ensureSession: () => Promise<string | null>;
  /**
   * 发送前的任务入口（workbench.ensureTask）：会话首条消息时创建任务，
   * 使该回合进入任务作用域（变更捕获/检查点/审查）。
   */
  ensureTask?: (sessionId: string) => Promise<void>;
  /** 错误提示。 */
  showError: (message: string) => void;
  /** i18n。 */
  t: (key: string) => string;
  /** 发送门禁：返回阻断文案时拒绝发送（恢复未决时的写工具门禁等）。 */
  sendGate?: () => string | null;
}

export interface ChatStream {
  messages: ChatMessage[];
  streaming: boolean;
  permission: ChatPermissionEvent | null;
  send: (text: string) => Promise<void>;
  stop: () => void;
  respondPermission: (requestId: string, choice: PermissionChoice) => Promise<void>;
}

export function useChatStream(deps: ChatStreamDeps): ChatStream {
  const { activeId, ensureSession, ensureTask, showError, t, sendGate } = deps;
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [permission, setPermission] = useState<ChatPermissionEvent | null>(null);
  const [, rerenderStreaming] = useState(0);
  const pendingPermissionQueuesRef = useRef(new Map<string, ChatPermissionEvent[]>());
  const streamingIdsRef = useRef(new Map<string, Set<string>>());
  const activeIdRef = useRef(activeId);
  const generationRef = useRef(0);
  const lastActiveIdRef = useRef(activeId);
  const respondingPermissionRef = useRef<string | null>(null);
  activeIdRef.current = activeId;
  if (lastActiveIdRef.current !== activeId) {
    lastActiveIdRef.current = activeId;
    generationRef.current += 1;
  }

  const setStreaming = useCallback((sessionId: string, messageId: string, streaming: boolean) => {
    const ids = streamingIdsRef.current.get(sessionId) ?? new Set<string>();
    if (streaming) ids.add(messageId);
    else ids.delete(messageId);
    if (ids.size === 0) streamingIdsRef.current.delete(sessionId);
    else streamingIdsRef.current.set(sessionId, ids);
    rerenderStreaming((version) => version + 1);
  }, []);

  const drainPermission = useCallback((sessionId: string) => {
    if (activeIdRef.current !== sessionId) return;
    const queue = pendingPermissionQueuesRef.current.get(sessionId);
    setPermission(queue?.[0] ?? null);
  }, []);

  const removePermission = useCallback((sessionId: string, requestId: string) => {
    const queue = pendingPermissionQueuesRef.current.get(sessionId);
    if (!queue) return;
    const next = queue.filter((event) => event.requestId !== requestId);
    if (next.length === 0) pendingPermissionQueuesRef.current.delete(sessionId);
    else pendingPermissionQueuesRef.current.set(sessionId, next);
    drainPermission(sessionId);
  }, [drainPermission]);

  const clearPermissionsForMessage = useCallback((sessionId: string, messageId: string) => {
    const queue = pendingPermissionQueuesRef.current.get(sessionId);
    if (!queue) return;
    const next = queue.filter((event) => event.messageId !== messageId);
    if (next.length === 0) pendingPermissionQueuesRef.current.delete(sessionId);
    else pendingPermissionQueuesRef.current.set(sessionId, next);
    drainPermission(sessionId);
  }, [drainPermission]);

  useEffect(() => {
    const sessionId = activeId;
    setMessages([]);
    setPermission(null);
    if (!sessionId) return;

    let cancelled = false;
    void api.listMessages(sessionId).then((nextMessages) => {
      if (!cancelled && activeIdRef.current === sessionId) setMessages(nextMessages);
    });
    drainPermission(sessionId);
    return () => {
      cancelled = true;
    };
  }, [activeId, drainPermission]);

  useEffect(() => {
    const off = api.onChatPermission((event) => {
      const queue = pendingPermissionQueuesRef.current.get(event.sessionId) ?? [];
      if (!queue.some((item) => item.requestId === event.requestId)) {
        queue.push(event);
        if (queue.length > MAX_PERMISSION_QUEUE) queue.shift();
        pendingPermissionQueuesRef.current.set(event.sessionId, queue);
      }
      drainPermission(event.sessionId);
      if (event.sessionId === activeIdRef.current && queue[0]?.requestId === event.requestId) {
        emitSidebarSessionStatus({ type: "permission", sessionId: event.sessionId });
      }
    });
    return off;
  }, [drainPermission]);

  useEffect(() => {
    const offDelta = api.onChatDelta((event) => {
      if (event.sessionId !== activeIdRef.current) return;
      emitSidebarSessionStatus({ type: "stream", sessionId: event.sessionId });
      setMessages((prev) => prev.map((message) =>
        message.id === event.messageId ? { ...message, parts: appendText(message.parts, event.delta) } : message,
      ));
    });
    const offDone = api.onChatDone((event) => {
      setStreaming(event.sessionId, event.messageId, false);
      clearPermissionsForMessage(event.sessionId, event.messageId);
      if (event.sessionId !== activeIdRef.current) return;
      emitSidebarSessionStatus({ type: "done", sessionId: event.sessionId });
      setMessages((prev) => prev.map((message) =>
        message.id === event.messageId
          ? { ...message, streaming: false, ...(event.completion ? { completion: event.completion } : {}) }
          : message,
      ));
    });
    const offError = api.onChatError((event) => {
      setStreaming(event.sessionId, event.messageId, false);
      clearPermissionsForMessage(event.sessionId, event.messageId);
      if (event.sessionId !== activeIdRef.current) return;
      emitSidebarSessionStatus({ type: "error", sessionId: event.sessionId });
      setMessages((prev) => prev.map((message) =>
        message.id === event.messageId
          ? { ...message, streaming: false, parts: appendText(appendText(message.parts, "\n\n> ⚠️ "), event.error) }
          : message,
      ));
    });
    const offTool = api.onChatTool((event) => {
      if (event.sessionId !== activeIdRef.current) return;
      setMessages((prev) => prev.map((message) =>
        message.id === event.messageId ? { ...message, parts: [...message.parts, event.part] } : message,
      ));
    });
    const offThinking = api.onChatThinking((event) => {
      if (event.sessionId !== activeIdRef.current) return;
      setMessages((prev) => prev.map((message) => {
        if (message.id !== event.messageId) return message;
        const last = message.parts[message.parts.length - 1];
        if (last?.type === "thinking") {
          const parts = [...message.parts];
          parts[parts.length - 1] = { type: "thinking", text: last.text + event.delta };
          return { ...message, parts };
        }
        return { ...message, parts: [...message.parts, { type: "thinking", text: event.delta }] };
      }));
    });
    return () => {
      offDelta();
      offDone();
      offError();
      offTool();
      offThinking();
    };
  }, [clearPermissionsForMessage, setStreaming]);

  const send = useCallback(async (text: string) => {
    const generation = generationRef.current;
    const wasLanding = activeId === null;
    const gateMessage = sendGate?.();
    if (gateMessage !== null && gateMessage !== undefined) {
      showError(gateMessage);
      return;
    }
    const sessionId = activeId ?? (await ensureSession());
    if (!sessionId) return;
    const isCurrent = () => {
      if (activeIdRef.current === null && wasLanding && generationRef.current === generation) return true;
      if (activeIdRef.current !== sessionId) return false;
      if (generationRef.current === generation) return true;
      return wasLanding && generationRef.current === generation + 1;
    };
    emitSidebarSessionStatus({ type: "started", sessionId });
    await ensureTask?.(sessionId);
    if (!isCurrent()) return;

    let messageId: string;
    try {
      ({ messageId } = await api.sendMessage(sessionId, text));
    } catch (error) {
      if (!isCurrent()) return;
      console.error("send message failed", error);
      emitSidebarSessionStatus({ type: "error", sessionId });
      showError(t("error.sendMessage"));
      return;
    }
    if (!isCurrent()) {
      void api.stopMessage(sessionId, messageId);
      return;
    }
    setStreaming(sessionId, messageId, true);
    const optimisticUser: ChatMessage = {
      id: `${messageId}_user`,
      role: "user",
      parts: [{ type: "text", text }],
      createdAt: Date.now(),
    };
    const pendingAssistant: ChatMessage = {
      id: messageId,
      role: "assistant",
      parts: [],
      createdAt: Date.now(),
      streaming: true,
    };
    setMessages((prev) => [...prev, optimisticUser, pendingAssistant]);
  }, [activeId, ensureSession, ensureTask, sendGate, setStreaming, showError, t]);

  const stop = useCallback(() => {
    if (!activeId) return;
    pendingPermissionQueuesRef.current.delete(activeId);
    if (activeIdRef.current === activeId) setPermission(null);
    for (const messageId of streamingIdsRef.current.get(activeId) ?? []) {
      void api.stopMessage(activeId, messageId);
    }
  }, [activeId]);

  const respondPermission = useCallback(async (requestId: string, choice: PermissionChoice): Promise<void> => {
    let pending: ChatPermissionEvent | undefined;
    for (const queue of pendingPermissionQueuesRef.current.values()) {
      pending = queue.find((event) => event.requestId === requestId);
      if (pending) break;
    }
    if (!pending || respondingPermissionRef.current === requestId) return;
    respondingPermissionRef.current = requestId;
    try {
      const response = api.respondChatPermission(requestId, choice);
      if (response && typeof response.then === "function") await response;
      const queue = pendingPermissionQueuesRef.current.get(pending.sessionId);
      const stillPending = queue?.some((event) => event.requestId === requestId) === true;
      removePermission(pending.sessionId, requestId);
      respondingPermissionRef.current = null;
      if (!stillPending) return;
      emitSidebarSessionStatus({ type: "permission-resolved", sessionId: pending.sessionId, decision: choice });
    } catch (error) {
      respondingPermissionRef.current = null;
      if (isMissingPermissionError(error)) removePermission(pending.sessionId, requestId);
      else {
        console.error("permission response failed", error);
        showError(t("error.permissionResponse"));
      }
    }
  }, [removePermission, showError, t]);

  return {
    messages,
    streaming: Boolean(activeId && streamingIdsRef.current.get(activeId)?.size),
    permission: permission?.sessionId === activeId ? permission : null,
    send,
    stop,
    respondPermission,
  };
}
