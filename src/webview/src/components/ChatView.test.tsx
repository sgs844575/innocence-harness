// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { ChatMessage, HarnessSettings } from "../../../shared/ipc";
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

/** 最小合法设置（Composer/ModelPicker 需要 profiles 等必填键）。 */
function settingsWith(overrides: Partial<HarnessSettings>): HarnessSettings {
  return {
    profiles: [],
    activeProfileId: "",
    activeModel: "",
    workspaceRoot: "",
    permissionMode: "ask",
    ...overrides,
  };
}

function renderChat(messages: ChatMessage[], extra: Partial<Parameters<typeof ChatView>[0]> = {}) {
  return render(
    <ChatView
      t={t}
      messages={messages}
      streaming={false}
      permission={null}
      question={null}
      settings={null}
      onPatchSettings={() => {}}
      onSend={() => {}}
      onEditResend={() => {}}
      onStop={() => {}}
      onPermissionRespond={() => {}}
      onQuestionRespond={() => {}}
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

  it("询问卡：单选即选、多选切换、全部作答后提交、跳过回 null", () => {
    const onQuestionRespond = vi.fn();
    renderChat([message({ id: "u1", role: "user" })], {
      question: {
        sessionId: "s1",
        messageId: "m1",
        requestId: "q1",
        toolName: "ask_user",
        questions: [
          {
            question: "用哪个数据库？",
            header: "数据库",
            options: [{ label: "PostgreSQL" }, { label: "SQLite" }],
          },
          {
            question: "要哪些迁移脚本？",
            multiSelect: true,
            options: [{ label: "schema" }, { label: "seed" }],
          },
        ],
      },
      onQuestionRespond,
    });
    // 未全作答时提交禁用。
    const submit = screen.getByRole("button", { name: "提交" }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: /PostgreSQL/ }));
    expect(submit.disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: /schema/ }));
    fireEvent.click(screen.getByRole("button", { name: /seed/ }));
    expect(submit.disabled).toBe(false);
    fireEvent.click(submit);
    expect(onQuestionRespond).toHaveBeenCalledWith("q1", {
      answers: [
        { question: "用哪个数据库？", answers: ["PostgreSQL"] },
        { question: "要哪些迁移脚本？", answers: ["schema", "seed"] },
      ],
    });
    // 跳过直接回 null。
    fireEvent.click(screen.getByRole("button", { name: "跳过" }));
    expect(onQuestionRespond).toHaveBeenCalledWith("q1", null);
  });

  it("消息流设置生效：showTodos=false 隐藏 todo 行，showThinking=false 只留首个思考块", () => {
    const settings = settingsWith({ showTodos: false, showThinking: false });
    const assistant = {
      ...message({ id: "a1", role: "assistant", streaming: false }),
      parts: [
        { type: "thinking", text: "先想" },
        { type: "toolCall", id: "c1", toolName: "TodoWrite", args: { todos: [{ content: "待办一", status: "pending" }] } },
        { type: "text", text: "再想" },
        { type: "thinking", text: "后想" },
      ],
      completion: { finishReason: "stop", aborted: false },
    } as ChatMessage;
    renderChat([message({ id: "u1", role: "user" }), assistant], { settings });
    expect(screen.queryByText("待办一")).toBeNull();
    // 思考行只剩首个（label 文案只出现一次）。
    expect(screen.getAllByText(zhCN["chat.thinking.label"])).toHaveLength(1);
    expect(screen.getByText("再想")).toBeTruthy();
  });

  it("工具分组默认开启（explore/terminal）：连续读取行聚合，连续写入行不聚合", () => {
    const assistant = {
      ...message({ id: "a1", role: "assistant", streaming: false }),
      parts: [
        { type: "toolCall", id: "c1", toolName: "Read", args: { file_path: "src/a.ts" } },
        { type: "toolCall", id: "c2", toolName: "Grep", args: { pattern: "foo" } },
        { type: "toolCall", id: "c3", toolName: "Write", args: { file_path: "src/x.ts", content: "x" } },
        { type: "toolCall", id: "c4", toolName: "Edit", args: { file_path: "src/y.ts", old_string: "a", new_string: "b" } },
      ],
      completion: { finishReason: "stop", aborted: false },
    } as ChatMessage;
    renderChat([message({ id: "u1", role: "user" }), assistant], { settings: settingsWith({}) });
    expect(screen.getByRole("button", { name: "展开探索" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "展开更改" })).toBeNull();
  });
});
