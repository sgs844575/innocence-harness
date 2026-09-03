// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { ChatMessage } from "../../../shared/ipc";
import { ChatView } from "./ChatView";
import { zhCN } from "../lib/i18n";

// jsdom 无布局：贴底滚动（scrollTo/scrollIntoView）打桩为 no-op。
beforeAll(() => {
  Element.prototype.scrollIntoView = () => {};
  Element.prototype.scrollTo = () => {};
});

afterEach(cleanup);

const t = (key: string) => zhCN[key] ?? key;

function message(overrides: Partial<ChatMessage> & { id: string; role: "user" | "assistant" }): ChatMessage {
  return { parts: [{ type: "text", text: "hello" }], createdAt: 1, ...overrides } as ChatMessage;
}

const capsule = { branch: "main", isGitRepo: true, changes: { changedFiles: 2, additions: 7, deletions: 3 }, todos: [] };

function renderChat(messages: ChatMessage[], extra: Partial<Parameters<typeof ChatView>[0]> = {}) {
  return render(
    <ChatView
      t={t}
      messages={messages}
      streaming={false}
      permission={null}
      settings={null}
      onPatchSettings={() => {}}
      onSend={() => {}}
      onEditResend={() => {}}
      onStop={() => {}}
      onPermissionRespond={() => {}}
      capsule={capsule}
      {...extra}
    />,
  );
}

describe("ChatView", () => {
  it("渲染用户气泡、助手正文与工具时间线", () => {
    const messages: ChatMessage[] = [
      message({ id: "u1", role: "user" }),
      {
        ...message({ id: "a1", role: "assistant", streaming: false }),
        parts: [
          { type: "thinking", text: "想一想" },
          { type: "toolCall", id: "c1", toolName: "Edit", args: { file_path: "D:/x/app.css", old_string: "a", new_string: "b" } },
          { type: "toolResult", toolCallId: "c1", content: "ok", isError: false },
          { type: "text", text: "完成了" },
        ],
        completion: { finishReason: "stop", aborted: false },
      } as ChatMessage,
    ];
    renderChat(messages);
    expect(screen.getByText("hello")).toBeTruthy();
    expect(screen.getByText("完成了")).toBeTruthy();
    expect(screen.getByText("app.css")).toBeTruthy();
    expect(screen.getByText("思考")).toBeTruthy();
    expect(screen.getByText("持续了几秒")).toBeTruthy();
    // Git 浮动面板
    expect(screen.getByText("Git 工具")).toBeTruthy();
    expect(screen.getByText("+7")).toBeTruthy();
  });

  it("末轮中断（无 completion）显示「继续」pill 并发送续跑提示词", () => {
    const onSend = vi.fn();
    renderChat(
      [message({ id: "u1", role: "user" }), message({ id: "a1", role: "assistant", streaming: false })],
      { onSend },
    );
    fireEvent.click(screen.getByRole("button", { name: "继续" }));
    expect(onSend).toHaveBeenCalledWith(zhCN["chat.continue.prompt"]);
  });

  it("最近一条用户消息编辑重发走 onEditResend（携带消息 id），不走普通发送", () => {
    const onSend = vi.fn();
    const onEditResend = vi.fn();
    renderChat(
      [
        message({ id: "u1", role: "user" }),
        message({ id: "a1", role: "assistant", streaming: false }),
        message({ id: "u2", role: "user", parts: [{ type: "text", text: "改我" }] }),
      ],
      { onSend, onEditResend },
    );
    fireEvent.click(screen.getByRole("button", { name: zhCN["chat.edit"] }));
    const area = screen.getByRole("textbox", { name: zhCN["chat.edit"] }) as HTMLTextAreaElement;
    fireEvent.change(area, { target: { value: "改好了" } });
    fireEvent.click(screen.getByRole("button", { name: zhCN["chat.edit.send"] }));
    expect(onEditResend).toHaveBeenCalledWith("u2", "改好了");
    expect(onSend).not.toHaveBeenCalled();
  });

  it("末轮完成或流式中不显示「继续」pill", () => {
    renderChat([
      message({ id: "u1", role: "user" }),
      { ...message({ id: "a1", role: "assistant", streaming: false }), completion: { finishReason: "stop", aborted: false } },
    ]);
    expect(screen.queryByRole("button", { name: "继续" })).toBeNull();
    cleanup();
    renderChat([message({ id: "u1", role: "user" })], { streaming: true });
    expect(screen.queryByRole("button", { name: "继续" })).toBeNull();
  });

  it("流式时时间线最底部渲染等待行（转圈 + 耐心等待提示）", () => {
    renderChat([message({ id: "u1", role: "user" })], { streaming: true });
    expect(screen.getByTestId("chat-waiting")).toBeTruthy();
    expect(screen.getByText(zhCN["chat.waiting.0"])).toBeTruthy();
  });

  it("非流式不渲染等待行", () => {
    renderChat([message({ id: "u1", role: "user" })]);
    expect(screen.queryByTestId("chat-waiting")).toBeNull();
  });

  it("胶囊默认不出现：非 Git 且无待办/智能体/终端时不渲染", () => {
    renderChat([message({ id: "u1", role: "user" })], {
      capsule: { branch: null, isGitRepo: false, todos: [] },
    });
    expect(screen.queryByRole("complementary")).toBeNull();
    expect(screen.queryByText("Git 工具")).toBeNull();
  });

  it("仅有待办清单（非 Git）时胶囊出现", () => {
    renderChat([message({ id: "u1", role: "user" })], {
      capsule: { branch: null, isGitRepo: false, todos: [{ content: "任务一", status: "pending" }] },
    });
    expect(screen.getByText("活动")).toBeTruthy();
    expect(screen.getByText("任务一")).toBeTruthy();
  });

  it("权限请求渲染批准卡并响应", () => {
    const onPermissionRespond = vi.fn();
    renderChat([message({ id: "u1", role: "user" })], {
      permission: {
        sessionId: "s1",
        messageId: "m1",
        requestId: "r1",
        toolName: "Edit",
        args: {},
        resource: { kind: "path", action: "write", scope: "a.ts" },
      },
      onPermissionRespond,
    });
    fireEvent.click(screen.getByRole("button", { name: "允许一次" }));
    expect(onPermissionRespond).toHaveBeenCalledWith("r1", "allow");
  });
});
