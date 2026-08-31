// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatMessage, ChatPermissionEvent } from "../../../shared/ipc";
import { ChatView } from "./ChatView";

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
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 1440, writable: true });
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

function renderChat(options: { permission?: ChatPermissionEvent } = {}): void {
  render(
    <ChatView
      t={(key) => key}
      appName="InnocenceHarness"
      taskTitle="Task seven"
      projectName="InnocenceCode"
      gitBranch="main"
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
}

describe("ChatView shared responsive layout", () => {
  it("responds to the chat container width when side panels change available space", () => {
    renderChat();
    expect(screen.getByLabelText("Agent 活动胶囊").className).toContain("agent-capsule-docked");

    act(() => resizeContainer?.(900));
    expect(screen.getByLabelText("Agent 活动胶囊").className).toContain("agent-capsule-overlay");

    act(() => resizeContainer?.(520));
    expect(screen.getByLabelText("Agent 活动胶囊").className).toContain("agent-capsule-sheet");
  });

  it("keeps the non-docked frame anchor while switching to overlay and sheet layouts", () => {
    renderChat();

    act(() => resizeContainer?.(900));
    expect(screen.getByTestId("chat-frame").style.maxWidth).toBe("");

    act(() => resizeContainer?.(520));
    expect(screen.getByTestId("chat-frame").style.maxWidth).toBe("720px");
  });

  it("uses the same content track for the permission card and composer", () => {
    renderChat({ permission });
    expect(screen.getByRole("alertdialog").parentElement?.style.maxWidth).toBe("960px");
    expect(screen.getByTestId("chat-composer").style.maxWidth).toBe("960px");
  });
  it("keeps timeline, composer, and docked capsule on one width model when collapsed", () => {
    renderChat();
    expect(screen.getByTestId("chat-timeline").style.maxWidth).toBe("960px");
    expect(screen.getByTestId("chat-composer").style.maxWidth).toBe("960px");
    expect(screen.getByLabelText("上下文数量").textContent).toContain("0");
    expect(screen.getByTestId("chat-capsule-slot").style.width).toBe("319px");
    expect(screen.getByTestId("chat-frame").style.maxWidth).toBe("");

    fireEvent.click(screen.getByRole("button", { name: "折叠活动胶囊" }));

    expect(screen.getByTestId("chat-timeline").style.maxWidth).toBe("960px");
    expect(screen.getByTestId("chat-composer").style.maxWidth).toBe("960px");
    expect(screen.getByTestId("chat-capsule-slot").style.width).toBe("319px");
    expect(screen.getByLabelText("当前进程胶囊")).toBeTruthy();
  });
});
