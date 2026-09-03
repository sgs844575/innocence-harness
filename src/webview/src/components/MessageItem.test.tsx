// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChatMessage } from "../../../shared/ipc";
import { MessageItem } from "./MessageItem";

afterEach(cleanup);

const t = (key: string) => key;

function message(overrides: Partial<ChatMessage> & { id: string; role: "user" | "assistant" }): ChatMessage {
  return { parts: [{ type: "text", text: "hello" }], createdAt: 1, ...overrides } as ChatMessage;
}

describe("MessageItem", () => {
  it("用户气泡悬停动作行带复制钮", () => {
    render(<MessageItem t={t} message={message({ id: "u1", role: "user" })} />);
    expect(screen.getByRole("button", { name: "chat.copy" })).toBeTruthy();
  });

  it("最近一条用户消息可编辑：Enter 或发送图标钮重发、Esc 或取消图标钮退出", () => {
    const onEditSend = vi.fn();
    render(<MessageItem t={t} message={message({ id: "u1", role: "user" })} canEdit onEditSend={onEditSend} />);
    fireEvent.click(screen.getByRole("button", { name: "chat.edit" }));
    const area = screen.getByRole("textbox", { name: "chat.edit" });
    fireEvent.change(area, { target: { value: "改成这个" } });
    fireEvent.keyDown(area, { key: "Enter" });
    expect(onEditSend).toHaveBeenCalledWith("改成这个");
    // 再次进入编辑，发送图标钮同样确认重发
    fireEvent.click(screen.getByRole("button", { name: "chat.edit" }));
    const again = screen.getByRole("textbox", { name: "chat.edit" }) as HTMLTextAreaElement;
    expect(again.value).toBe("hello");
    fireEvent.change(again, { target: { value: "用按钮发" } });
    fireEvent.click(screen.getByRole("button", { name: "chat.edit.send" }));
    expect(onEditSend).toHaveBeenCalledWith("用按钮发");
    // 第三次进入编辑：Esc 取消且不重发；取消图标钮同样退出
    fireEvent.click(screen.getByRole("button", { name: "chat.edit" }));
    fireEvent.keyDown(screen.getByRole("textbox", { name: "chat.edit" }), { key: "Escape" });
    expect(screen.queryByRole("textbox", { name: "chat.edit" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "chat.edit" }));
    fireEvent.click(screen.getByRole("button", { name: "chat.edit.cancel" }));
    expect(screen.queryByRole("textbox", { name: "chat.edit" })).toBeNull();
    expect(onEditSend).toHaveBeenCalledTimes(2);
  });

  it("编辑态发送图标钮在空文本（纯空白）时禁用", () => {
    render(<MessageItem t={t} message={message({ id: "u1", role: "user" })} canEdit onEditSend={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "chat.edit" }));
    const area = screen.getByRole("textbox", { name: "chat.edit" });
    fireEvent.change(area, { target: { value: "   " } });
    const send = screen.getByRole("button", { name: "chat.edit.send" }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
  });

  it("非最近一条用户消息不出编辑钮", () => {
    render(<MessageItem t={t} message={message({ id: "u1", role: "user" })} />);
    expect(screen.queryByRole("button", { name: "chat.edit" })).toBeNull();
  });

  it("中断的助手消息带「继续」图标钮并回调", () => {
    const onContinue = vi.fn();
    render(
      <MessageItem t={t} message={message({ id: "a1", role: "assistant", streaming: false })} continuable onContinue={onContinue} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "chat.continue" }));
    expect(onContinue).toHaveBeenCalledTimes(1);
  });

  it("正常完成的助手消息不带「继续」钮", () => {
    render(<MessageItem t={t} message={message({ id: "a1", role: "assistant", streaming: false })} />);
    expect(screen.queryByRole("button", { name: "chat.continue" })).toBeNull();
  });
});
