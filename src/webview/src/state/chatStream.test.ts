import { describe, expect, it } from "vitest";
import type { ChatContextUsageSnapshot, ChatQuestionEvent, ToolCallPart } from "../../../shared/ipc";
import { initialChatStreamState, reduceChatStream } from "./chatStream";

const toolCall: ToolCallPart = { type: "toolCall", id: "tc1", toolName: "Edit", args: { file_path: "a.ts" } };

describe("reduceChatStream", () => {
  it("delta 到达时创建助手消息并追加文本", () => {
    let state = reduceChatStream(initialChatStreamState, { type: "delta", messageId: "m1", delta: "你好", at: 1 });
    state = reduceChatStream(state, { type: "delta", messageId: "m1", delta: "，世界", at: 2 });
    expect(state.messages).toHaveLength(1);
    expect(state.messages[0]).toMatchObject({ id: "m1", role: "assistant", streaming: true });
    expect(state.messages[0]!.parts).toEqual([{ type: "text", text: "你好，世界" }]);
    expect(state.streaming).toBe(true);
  });

  it("thinking 增量并入末尾 thinking part", () => {
    let state = reduceChatStream(initialChatStreamState, { type: "thinking", messageId: "m1", delta: "先", at: 1 });
    state = reduceChatStream(state, { type: "thinking", messageId: "m1", delta: "想想", at: 2 });
    state = reduceChatStream(state, { type: "delta", messageId: "m1", delta: "正文", at: 3 });
    expect(state.messages[0]!.parts).toEqual([
      { type: "thinking", text: "先想想" },
      { type: "text", text: "正文" },
    ]);
  });

  it("tool 事件按序追加 part；done 落定 completion 并结束流式", () => {
    let state = reduceChatStream(initialChatStreamState, { type: "tool", messageId: "m1", part: toolCall, at: 1 });
    state = reduceChatStream(state, {
      type: "tool",
      messageId: "m1",
      part: { type: "toolResult", toolCallId: "tc1", content: "ok", isError: false },
      at: 2,
    });
    expect(state.messages[0]!.parts).toHaveLength(2);
    state = reduceChatStream(state, {
      type: "done",
      messageId: "m1",
      completion: { finishReason: "stop", aborted: false, modelId: "m" },
    });
    expect(state.streaming).toBe(false);
    expect(state.messages[0]!.streaming).toBe(false);
    expect(state.messages[0]!.completion?.finishReason).toBe("stop");
  });

  it("error 结束流式并追加错误文本", () => {
    let state = reduceChatStream(initialChatStreamState, { type: "delta", messageId: "m1", delta: "半截", at: 1 });
    state = reduceChatStream(state, { type: "error", messageId: "m1", error: "boom" });
    expect(state.streaming).toBe(false);
    expect(state.messages[0]!.streaming).toBe(false);
    expect(state.messages[0]!.parts[0]).toMatchObject({ type: "text" });
    expect((state.messages[0]!.parts[0] as { text: string }).text).toContain("boom");
  });

  it("send-local 追加用户消息并进入流式；permission 事件置位/清除", () => {
    let state = reduceChatStream(initialChatStreamState, {
      type: "send-local",
      message: { id: "u1", role: "user", parts: [{ type: "text", text: "hi" }], createdAt: 1 },
    });
    expect(state.messages[0]!.role).toBe("user");
    expect(state.streaming).toBe(true);
    const event = {
      sessionId: "s1",
      messageId: "m1",
      requestId: "r1",
      toolName: "Edit",
      args: {},
      resource: { kind: "path", action: "write", scope: "a.ts" },
    } as const;
    state = reduceChatStream(state, { type: "permission", event });
    expect(state.permission?.requestId).toBe("r1");
    state = reduceChatStream(state, { type: "permission-clear" });
    expect(state.permission).toBeNull();
  });

  it("question 事件置位/清除询问卡；load/reset 一并清空", () => {
    const event: ChatQuestionEvent = {
      sessionId: "s1",
      messageId: "m1",
      requestId: "q1",
      toolName: "ask_user",
      questions: [{ question: "选哪个？", options: [{ label: "A" }, { label: "B" }] }],
    };
    let state = reduceChatStream(initialChatStreamState, { type: "question", event });
    expect(state.question?.requestId).toBe("q1");
    expect(state.question?.questions[0]?.options).toHaveLength(2);
    state = reduceChatStream(state, { type: "question-clear" });
    expect(state.question).toBeNull();
    // load（切会话回读）同样清掉挂起卡，避免残留到下一会话。
    state = reduceChatStream(state, { type: "question", event });
    state = reduceChatStream(state, { type: "load", messages: [] });
    expect(state.question).toBeNull();
    state = reduceChatStream(state, { type: "question", event });
    state = reduceChatStream(state, { type: "reset" });
    expect(state.question).toBeNull();
  });

  it("question-settled 仅清匹配当前卡的落定；done/error 兜底清权限与询问卡", () => {
    const event: ChatQuestionEvent = {
      sessionId: "s1",
      messageId: "m1",
      requestId: "q1",
      toolName: "ask_user",
      questions: [{ question: "选哪个？", options: [{ label: "A" }] }],
    };
    let state = reduceChatStream(initialChatStreamState, { type: "question", event });
    // 他人/迟到的落定不清当前卡。
    state = reduceChatStream(state, { type: "question-settled", requestId: "other" });
    expect(state.question?.requestId).toBe("q1");
    state = reduceChatStream(state, { type: "question-settled", requestId: "q1" });
    expect(state.question).toBeNull();
    // done/error 兜底：停止/超时路径下未经渲染层落定的卡不残留。
    state = reduceChatStream(state, { type: "question", event });
    state = reduceChatStream(state, {
      type: "permission",
      event: {
        sessionId: "s1",
        messageId: "m1",
        requestId: "r1",
        toolName: "Edit",
        args: {},
        resource: { kind: "path", action: "write", scope: "a.ts" },
      },
    });
    state = reduceChatStream(state, { type: "done", messageId: "m1" });
    expect(state.question).toBeNull();
    expect(state.permission).toBeNull();
    state = reduceChatStream(initialChatStreamState, { type: "question", event });
    state = reduceChatStream(state, { type: "error", messageId: "m1", error: "boom" });
    expect(state.question).toBeNull();
  });

  it("resend-local 截断被编辑消息起的全部消息并换成新用户消息", () => {
    let state = initialChatStreamState;
    state = reduceChatStream(state, {
      type: "send-local",
      message: { id: "u1", role: "user", parts: [{ type: "text", text: "第一问" }], createdAt: 1 },
    });
    state = reduceChatStream(state, { type: "delta", messageId: "a1", delta: "第一答", at: 2 });
    state = reduceChatStream(state, {
      type: "send-local",
      message: { id: "u2", role: "user", parts: [{ type: "text", text: "要编辑的问" }], createdAt: 3 },
    });
    state = reduceChatStream(state, { type: "delta", messageId: "a2", delta: "第二答", at: 4 });
    state = reduceChatStream(state, {
      type: "resend-local",
      messageId: "u2",
      message: { id: "u3", role: "user", parts: [{ type: "text", text: "改后的问" }], createdAt: 5 },
    });
    expect(state.messages.map((m) => m.id)).toEqual(["u1", "a1", "u3"]);
    expect(state.streaming).toBe(true);
  });

  it("resend-local 未知消息 id 时退化为普通追加", () => {
    let state = reduceChatStream(initialChatStreamState, {
      type: "send-local",
      message: { id: "u1", role: "user", parts: [{ type: "text", text: "第一问" }], createdAt: 1 },
    });
    state = reduceChatStream(state, {
      type: "resend-local",
      messageId: "missing",
      message: { id: "u2", role: "user", parts: [{ type: "text", text: "新问" }], createdAt: 2 },
    });
    expect(state.messages.map((m) => m.id)).toEqual(["u1", "u2"]);
  });

  it("context-usage action 更新快照；reset 清空", () => {
    const snap: ChatContextUsageSnapshot = {
      inputTokens: 200,
      breakdown: { systemPrompt: 60, skills: 10, systemTools: 20, mcpTools: 10, messages: 90, other: 10 },
      cache: { inputTokens: 300, cachedInputTokens: 150 },
      contextWindow: 1000,
    };
    let state = reduceChatStream(initialChatStreamState, { type: "context-usage", snapshot: snap });
    expect(state.contextUsage).toEqual(snap);
    state = reduceChatStream(state, { type: "reset" });
    expect(state.contextUsage).toBeNull();
  });
});
