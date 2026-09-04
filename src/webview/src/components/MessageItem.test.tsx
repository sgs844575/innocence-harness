// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChatMessage } from "../../../shared/ipc";
import { MessageItem } from "./MessageItem";
import type { StreamDisplayOptions } from "./chat/toolGrouping";

afterEach(cleanup);

const t = (key: string) => key;

const STREAM_DEFAULTS: StreamDisplayOptions = {
  showThinking: true,
  showTodos: true,
  grouping: { explore: true, terminal: true, changes: false },
};

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

  it("思考显示关闭：只渲染首个思考块，后续思考段隐藏；开启时全部渲染", () => {
    const parts: ChatMessage["parts"] = [
      { type: "thinking", text: "第一段" },
      { type: "text", text: "正文" },
      { type: "thinking", text: "第二段" },
    ];
    const thinkingMessage = message({ id: "a1", role: "assistant", streaming: false, parts });
    render(<MessageItem t={t} message={thinkingMessage} stream={{ ...STREAM_DEFAULTS, showThinking: false }} />);
    expect(screen.getAllByTitle("chat.thinking.label")).toHaveLength(1);
    cleanup();
    render(<MessageItem t={t} message={thinkingMessage} stream={STREAM_DEFAULTS} />);
    expect(screen.getAllByTitle("chat.thinking.label")).toHaveLength(2);
    cleanup();
    // 缺省 stream prop = 旧行为（全显）。
    render(<MessageItem t={t} message={thinkingMessage} />);
    expect(screen.getAllByTitle("chat.thinking.label")).toHaveLength(2);
  });

  it("todo 显示关闭：todo 工具行隐藏（其余行保留，滤空段不渲染）；开启时显示", () => {
    const todoMessage = message({
      id: "a1",
      role: "assistant",
      streaming: false,
      parts: [
        { type: "toolCall", id: "c1", toolName: "TodoWrite", args: { todos: [{ content: "待办一", status: "in_progress" }] } },
        { type: "toolCall", id: "c2", toolName: "Read", args: { file_path: "src/a.ts" } },
      ],
    });
    render(<MessageItem t={t} message={todoMessage} stream={{ ...STREAM_DEFAULTS, showTodos: false }} />);
    expect(screen.queryByText("待办一")).toBeNull();
    expect(screen.getByText("a.ts")).toBeTruthy();
    cleanup();
    render(<MessageItem t={t} message={todoMessage} stream={STREAM_DEFAULTS} />);
    // 行标题与收起态清单各一处文本，均存在即说明 todo 行已渲染。
    expect(screen.getAllByText("待办一").length).toBeGreaterThan(0);
  });

  it("todo 显示关闭且段内仅剩 todo 行：工具段整体不渲染", () => {
    const onlyTodo = message({
      id: "a1",
      role: "assistant",
      streaming: false,
      parts: [
        { type: "toolCall", id: "c1", toolName: "TodoWrite", args: { todos: [{ content: "待办一", status: "pending" }] } },
      ],
    });
    const { container } = render(<MessageItem t={t} message={onlyTodo} stream={{ ...STREAM_DEFAULTS, showTodos: false }} />);
    expect(screen.queryByText("待办一")).toBeNull();
    expect(container.querySelector(".group\\/tool-row")).toBeNull();
  });

  it("分组开关经 stream prop 传到工具时间线：连续读取行聚合为 Explore 组", () => {
    const readMessage = message({
      id: "a1",
      role: "assistant",
      streaming: false,
      parts: [
        { type: "toolCall", id: "c1", toolName: "Read", args: { file_path: "src/a.ts" } },
        { type: "toolCall", id: "c2", toolName: "Read", args: { file_path: "src/b.ts" } },
      ],
    });
    render(<MessageItem t={t} message={readMessage} stream={STREAM_DEFAULTS} />);
    expect(screen.getByText("tool.group.explore")).toBeTruthy();
    cleanup();
    render(
      <MessageItem t={t} message={readMessage} stream={{ ...STREAM_DEFAULTS, grouping: { explore: false, terminal: true, changes: false } }} />,
    );
    expect(screen.queryByText("tool.group.explore")).toBeNull();
  });
});
