// 聊天流式装配（纯函数，可单测）：把 chat:delta / chat:thinking / chat:tool /
// chat:done / chat:error 事件流折叠成消息列表。助手消息在首个事件到达时创建，
// 文本/思考增量并入末尾同类型 part，工具调用与结果按序追加（渲染层再配对）。
import {
  appendText,
  type ChatCompletionMetadata,
  type ChatMessage,
  type ChatPermissionEvent,
  type ToolCallPart,
  type ToolResultPart,
} from "../../../shared/ipc";

export interface ChatStreamState {
  messages: ChatMessage[];
  streaming: boolean;
  permission: ChatPermissionEvent | null;
}

export const initialChatStreamState: ChatStreamState = {
  messages: [],
  streaming: false,
  permission: null,
};

export type ChatStreamAction =
  | { type: "load"; messages: ChatMessage[] }
  | { type: "reset" }
  | { type: "send-local"; message: ChatMessage }
  | { type: "resend-local"; messageId: string; message: ChatMessage }
  | { type: "delta"; messageId: string; delta: string; at: number }
  | { type: "thinking"; messageId: string; delta: string; at: number }
  | { type: "tool"; messageId: string; part: ToolCallPart | ToolResultPart; at: number }
  | { type: "done"; messageId: string; completion?: ChatCompletionMetadata }
  | { type: "error"; messageId: string; error: string }
  | { type: "permission"; event: ChatPermissionEvent }
  | { type: "permission-clear" };

function withAssistant(state: ChatStreamState, messageId: string, at: number): ChatMessage[] {
  const existing = state.messages.find((m) => m.id === messageId);
  if (existing) return state.messages;
  return [
    ...state.messages,
    { id: messageId, role: "assistant", parts: [], createdAt: at, streaming: true },
  ];
}

function patchMessage(
  messages: ChatMessage[],
  messageId: string,
  patch: (message: ChatMessage) => ChatMessage,
): ChatMessage[] {
  return messages.map((m) => (m.id === messageId ? patch(m) : m));
}

function appendThinking(parts: ChatMessage["parts"], delta: string): ChatMessage["parts"] {
  const last = parts[parts.length - 1];
  if (last?.type === "thinking") {
    const next = [...parts];
    next[next.length - 1] = { type: "thinking", text: last.text + delta };
    return next;
  }
  return [...parts, { type: "thinking", text: delta }];
}

export function reduceChatStream(state: ChatStreamState, action: ChatStreamAction): ChatStreamState {
  switch (action.type) {
    case "load":
      return { ...state, messages: action.messages, streaming: false, permission: null };
    case "reset":
      return initialChatStreamState;
    case "send-local":
      return { ...state, messages: [...state.messages, action.message], streaming: true };
    case "resend-local": {
      // 编辑重发的乐观截断：被编辑消息（含）之后的全部换成新用户消息；
      // 主进程失败时 useChatStream 会从存储重载恢复真态。
      const index = state.messages.findIndex((m) => m.id === action.messageId);
      const kept = index < 0 ? state.messages : state.messages.slice(0, index);
      return { ...state, messages: [...kept, action.message], streaming: true };
    }
    case "delta": {
      const messages = withAssistant(state, action.messageId, action.at);
      return {
        ...state,
        streaming: true,
        messages: patchMessage(messages, action.messageId, (m) => ({
          ...m,
          streaming: true,
          parts: appendText(m.parts, action.delta),
        })),
      };
    }
    case "thinking": {
      const messages = withAssistant(state, action.messageId, action.at);
      return {
        ...state,
        streaming: true,
        messages: patchMessage(messages, action.messageId, (m) => ({
          ...m,
          streaming: true,
          parts: appendThinking(m.parts, action.delta),
        })),
      };
    }
    case "tool": {
      const messages = withAssistant(state, action.messageId, action.at);
      return {
        ...state,
        streaming: true,
        messages: patchMessage(messages, action.messageId, (m) => ({
          ...m,
          streaming: true,
          parts: [...m.parts, action.part],
        })),
      };
    }
    case "done":
      return {
        ...state,
        streaming: false,
        messages: patchMessage(state.messages, action.messageId, (m) => ({
          ...m,
          streaming: false,
          ...(action.completion ? { completion: action.completion } : {}),
        })),
      };
    case "error":
      return {
        ...state,
        streaming: false,
        messages: patchMessage(state.messages, action.messageId, (m) => ({
          ...m,
          streaming: false,
          parts: appendText(m.parts, `\n\n⚠ ${action.error}`),
        })),
      };
    case "permission":
      return { ...state, permission: action.event };
    case "permission-clear":
      return { ...state, permission: null };
    default:
      return state;
  }
}
