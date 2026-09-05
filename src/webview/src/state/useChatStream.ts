// 会话聊天流：按激活会话装载消息 + 订阅流式事件进 reducer。
import { useCallback, useEffect, useReducer, useRef } from "react";
import type { AttachmentPart, ChatMessage, ChatQuestionResponse, PermissionChoice } from "../../../shared/ipc";
import { api, hasBridge } from "../lib/ipc";
import { initialChatStreamState, reduceChatStream, type ChatStreamState } from "./chatStream";

export interface ChatStreamController extends ChatStreamState {
  send: (text: string, attachments?: AttachmentPart[]) => Promise<void>;
  /** 编辑重发（替换语义）：乐观截断被编辑消息起的历史并重发新文本；
   *  失败时回读存储恢复截断前的真态。 */
  resend: (messageId: string, text: string) => Promise<void>;
  stop: () => Promise<void>;
  respondPermission: (requestId: string, choice: PermissionChoice) => Promise<void>;
  /** 询问卡作答：answers 与请求问题对齐；null = 跳过。 */
  respondQuestion: (requestId: string, response: ChatQuestionResponse) => Promise<void>;
}

/** 乐观用户气泡 id：渲染层生成并透传给主进程落账（同 id），后续编辑重发
 *  的存储截断才能找到这条消息。 */
const userMessageId = (): string =>
  `msg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}_u`;

export function useChatStream({
  activeId,
  ensureSessionForSend,
  onError,
}: {
  activeId: string | null;
  ensureSessionForSend: () => Promise<string>;
  onError: (message: string) => void;
}): ChatStreamController {
  const [state, dispatch] = useReducer(reduceChatStream, initialChatStreamState);
  const activeIdRef = useRef(activeId);
  activeIdRef.current = activeId;
  const stateRef = useRef(state);
  stateRef.current = state;

  // 切会话：重载消息；随后回放该会话仍挂起的问题卡（提问可能跨越会话
  // 切换——卡片是瞬态推送，回来时从主进程注册表补卡，提问不至于悬死）。
  useEffect(() => {
    if (!hasBridge()) return;
    if (activeId === null) {
      dispatch({ type: "reset" });
      return;
    }
    let cancelled = false;
    void api
      .listMessages(activeId)
      .then((messages: ChatMessage[]) => {
        if (!cancelled) dispatch({ type: "load", messages });
      })
      .catch(() => undefined);
    void api
      .listPendingQuestions(activeId)
      .then((events) => {
        if (cancelled || events.length === 0) return;
        dispatch({ type: "question", event: events[events.length - 1]! });
      })
      .catch(() => undefined);
    // 切会话补查最近一次计量快照（推送是瞬态的，回来时向主进程回读）。
    void api
      .queryContextUsage(activeId)
      .then((snapshot) => {
        if (!cancelled) dispatch({ type: "context-usage", snapshot: snapshot ?? null });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [activeId]);

  // 事件订阅常驻：按事件携带的 sessionId 过滤到当前激活会话。
  useEffect(() => {
    if (!hasBridge()) return;
    const forActive = (sessionId: string) => sessionId === activeIdRef.current;
    const offs = [
      api.onChatDelta((e) => {
        if (forActive(e.sessionId)) dispatch({ type: "delta", messageId: e.messageId, delta: e.delta, at: Date.now() });
      }),
      api.onChatThinking((e) => {
        if (forActive(e.sessionId)) dispatch({ type: "thinking", messageId: e.messageId, delta: e.delta, at: Date.now() });
      }),
      api.onChatTool((e) => {
        if (forActive(e.sessionId)) dispatch({ type: "tool", messageId: e.messageId, part: e.part, at: Date.now() });
      }),
      api.onChatDone((e) => {
        if (forActive(e.sessionId)) dispatch({ type: "done", messageId: e.messageId, completion: e.completion });
      }),
      api.onChatError((e) => {
        if (forActive(e.sessionId)) dispatch({ type: "error", messageId: e.messageId, error: e.error });
      }),
      api.onChatContextUsage((e) => {
        if (forActive(e.sessionId)) dispatch({ type: "context-usage", snapshot: e.snapshot });
      }),
      api.onChatPermission((e) => {
        if (forActive(e.sessionId)) dispatch({ type: "permission", event: e });
      }),
      api.onChatQuestion((e) => {
        if (forActive(e.sessionId)) dispatch({ type: "question", event: e });
      }),
      // 非渲染层落定（超时跳过/停止/关机）：按 requestId 精确清卡。
      api.onChatQuestionSettled((e) => {
        dispatch({ type: "question-settled", requestId: e.requestId });
      }),
    ];
    return () => offs.forEach((off) => off());
  }, []);

  const send = useCallback(
    async (text: string, attachments: AttachmentPart[] = []) => {
      const content = text.trim();
      // 附件-only 轮也是真实用户轮（文本可为空）。
      if (!content && attachments.length === 0) return;
      let sessionId: string;
      try {
        sessionId = await ensureSessionForSend();
      } catch {
        onError("createSession");
        return;
      }
      const id = userMessageId();
      dispatch({
        type: "send-local",
        message: {
          id,
          role: "user",
          parts: [
            ...(content ? [{ type: "text" as const, text: content }] : []),
            ...attachments,
          ],
          createdAt: Date.now(),
        },
      });
      try {
        await api.sendMessage(sessionId, content, id, attachments.length > 0 ? attachments : undefined);
      } catch {
        onError("sendMessage");
        dispatch({ type: "error", messageId: "", error: "send failed" });
      }
    },
    [ensureSessionForSend, onError],
  );

  const stop = useCallback(async () => {
    const { messages } = stateRef.current;
    const active = activeIdRef.current;
    if (active === null) return;
    const streamingMessage = [...messages].reverse().find((m) => m.streaming === true);
    if (streamingMessage) {
      await api.stopMessage(active, streamingMessage.id).catch(() => undefined);
    }
  }, []);

  const resend = useCallback(
    async (messageId: string, text: string) => {
      const content = text.trim();
      if (!content) return;
      let sessionId: string;
      try {
        sessionId = await ensureSessionForSend();
      } catch {
        onError("createSession");
        return;
      }
      const id = userMessageId();
      dispatch({
        type: "resend-local",
        messageId,
        message: {
          id,
          role: "user",
          parts: [{ type: "text", text: content }],
          createdAt: Date.now(),
        },
      });
      try {
        await api.resendMessage(sessionId, messageId, content, id);
      } catch {
        // 截断已被主进程拒绝（运行中/任务绑定/未知消息）：提示并回读存储，
        // 恢复截断前的真态，避免乐观 UI 与存储分叉。
        onError("resendFailed");
        const active = activeIdRef.current;
        if (active !== null) {
          const messages: ChatMessage[] = await api.listMessages(active).catch(() => []);
          dispatch({ type: "load", messages });
        }
      }
    },
    [ensureSessionForSend, onError],
  );

  const respondPermission = useCallback(async (requestId: string, choice: PermissionChoice) => {
    dispatch({ type: "permission-clear" });
    await api.respondChatPermission(requestId, choice).catch(() => undefined);
  }, []);

  const respondQuestion = useCallback(async (requestId: string, response: ChatQuestionResponse) => {
    dispatch({ type: "question-clear" });
    await api.respondChatQuestion(requestId, response).catch(() => undefined);
  }, []);

  return { ...state, send, resend, stop, respondPermission, respondQuestion };
}
