// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatMessage, ChatPermissionEvent } from "../../../shared/ipc";
import { ChatView } from "./ChatView";

const { isWindowMaximized, onWindowMaximizedChanged } = vi.hoisted(() => ({
  isWindowMaximized: vi.fn(() => Promise.resolve(true)),
  onWindowMaximizedChanged: vi.fn((_cb: (maximized: boolean) => void) => () => {}),
}));

vi.mock("../lib/ipc", () => ({
  api: { isWindowMaximized, onWindowMaximizedChanged },
}));

let resizeContainer: ((width: number) => void) | undefined;

class ResizeObserverStub implements ResizeObserver {
  constructor(callback: ResizeObserverCallback) {
    resizeContainer = (width) => callback([
      { contentRect: { width } } as ResizeObserverEntry,
    ], this);
  }

  disconnect(): void {}
  observe(): void {}
  unobserve(): void {}
}

beforeAll(() => {
  Element.prototype.scrollIntoView = () => {};
});

beforeEach(() => {
  resizeContainer = undefined;
  isWindowMaximized.mockImplementation(() => Promise.resolve(true));
  onWindowMaximizedChanged.mockImplementation((_cb: (maximized: boolean) => void) => () => {});
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1440, writable: true });
    Object.defineProperty(window, "outerWidth", { configurable: true, value: 1024, writable: true });
  });

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const message: ChatMessage = {
  id: "assistant",
  role: "assistant",
  createdAt: 1,
  parts: [{ type: "text", text: "Ready" }],
};

const permission: ChatPermissionEvent = {
  sessionId: "s1",
  messageId: "m1",
  requestId: "p1",
  toolName: "Write",
  args: { path: "src/a.ts" },
  resource: { kind: "file", action: "write", scope: "src/a.ts" },
};

const activity = {
  environment: {
    branch: "main",
    changedFiles: 2,
    additions: 7,
    deletions: 3,
    workspaceKind: "git",
  },
  process: { completed: 2, total: 7, current: "Implement layout", pending: 4 },
  terminal: { durationMs: 30_000, backgroundTasks: 1 },
  agent: { name: "default", status: "running" as const },
};

function renderChat(options: { permission?: ChatPermissionEvent; width?: number } = {}): void {
  render(
    <ChatView
      t={(key) => key}
      appName="InnocenceHarness"
      messages={[message]}
      streaming={false}
      settings={null}
      permission={options.permission ?? null}
      onSettingsChange={() => {}}
      onPermissionRespond={() => {}}
      onSend={() => {}}
      onStop={() => {}}
      landing={false}
      pendingProject=""
      onPickProject={() => {}}
      recentProjects={[]}
      onOpenProjectDir={() => {}}
      activity={activity}
    />,
  );
  // jsdom 无布局：ResizeObserver 要手动喂容器实宽。默认按「1440 窗口、侧栏
  // 展开」的主列宽（1175）；收起侧栏后容器回到窗口宽，由用例传入 width。
  act(() => resizeContainer?.(options.width ?? 1175));
}

describe("ChatView shared responsive layout", () => {
  it("responds to the chat container width when side panels change available space", () => {
    renderChat();
    expect(screen.getByLabelText("Agent 活动胶囊").className).toContain("agent-capsule-floating");

    act(() => resizeContainer?.(900));
    expect(screen.getByLabelText("Agent 活动胶囊").className).toContain("agent-capsule-floating");

    act(() => resizeContainer?.(520));
    expect(screen.getByLabelText("Agent 活动胶囊").className).toContain("agent-capsule-sheet");
  });

  it("keeps the contracted reading column while switching to sheet layout", () => {
    renderChat();

    act(() => resizeContainer?.(900));
    expect(screen.getByTestId("chat-timeline").style.maxWidth).toBe("419px");

    act(() => resizeContainer?.(520));
    expect(screen.getByTestId("chat-timeline").style.maxWidth).toBe("520px");
  });

  it("uses the same content track for the permission card and composer", () => {
    renderChat({ permission, width: 1440 });
    expect(screen.getByRole("alertdialog").parentElement?.style.maxWidth).toBe("888px");
    expect(screen.getByTestId("chat-composer").style.maxWidth).toBe("888px");
  });
  it("keeps the contracted width model while the capsule is collapsed", () => {
    renderChat({ width: 1440 });
    expect(screen.getByTestId("chat-timeline").style.maxWidth).toBe("888px");
    expect(screen.getByTestId("chat-composer").style.maxWidth).toBe("888px");
    expect(screen.getByLabelText("上下文数量").textContent).toContain("0");
    expect(screen.getByLabelText("Agent 活动胶囊").className).toContain("agent-capsule-floating");

    fireEvent.click(screen.getByRole("button", { name: "折叠活动胶囊" }));

    expect(screen.getByTestId("chat-timeline").style.maxWidth).toBe("888px");
    expect(screen.getByTestId("chat-composer").style.maxWidth).toBe("888px");
    expect(screen.getByLabelText("当前进程胶囊")).toBeTruthy();
  });

  it("centers the chat column with equal gutters while the window is not maximized", async () => {
    Object.defineProperty(window, "outerWidth", { configurable: true, value: 800, writable: true });
    isWindowMaximized.mockImplementation(() => Promise.resolve(false));
    renderChat({ width: 1440 });
    await waitFor(() => expect(screen.getByTestId("chat-timeline").style.maxWidth).toBe("1120px"));
    expect(screen.getByTestId("chat-composer").style.maxWidth).toBe("1120px");
    expect(screen.getByLabelText("Agent 活动胶囊").className).toContain("agent-capsule-floating");
  });

  it("re-centers the chat column when the window leaves maximized state", async () => {
    let notify: ((maximized: boolean) => void) | undefined;
    onWindowMaximizedChanged.mockImplementation((cb: (maximized: boolean) => void) => {
      notify = cb;
      return () => {};
    });
    renderChat({ width: 1440 });
    expect(screen.getByTestId("chat-timeline").style.maxWidth).toBe("888px");

    act(() => notify?.(false));
    await waitFor(() => expect(screen.getByTestId("chat-timeline").style.maxWidth).toBe("1120px"));
  });

  it("recomputes the reading column from the chat container width, not the window width", () => {
    renderChat();
    expect(window.innerWidth).toBe(1440);
    // 1175 最大化：左 94、右 337+94=431、列 = 1175-94-431 = 650
    expect(screen.getByTestId("chat-timeline").style.maxWidth).toBe("650px");

    // 侧栏收起后容器涨到窗口宽、窗口宽度不变：列必须按容器重算。
    act(() => resizeContainer?.(1440));
    expect(window.innerWidth).toBe(1440);
    expect(screen.getByTestId("chat-timeline").style.maxWidth).toBe("888px");
    expect(screen.getByTestId("chat-composer").style.maxWidth).toBe("888px");
  });
});
