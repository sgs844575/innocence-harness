// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "../../../shared/ipc";
import { SessionRow } from "./SessionRow";

const session: Session = {
  id: "s1",
  title: "修复消息重编辑回车重新发送的长标题场景",
  createdAt: 0,
  updatedAt: 100,
  messageCount: 2,
  workspaceRoot: "",
};

function renderRow(extra: Partial<Parameters<typeof SessionRow>[0]> = {}) {
  return render(
    <ul>
      <SessionRow
        session={session}
        active={false}
        running={false}
        onSelect={() => {}}
        onArchive={() => {}}
        archiveLabel="sidebar.archive"
        {...extra}
      />
    </ul>,
  );
}

beforeEach(() => {
  (window as unknown as Record<string, unknown>).innocencecode = {
    listMessages: vi.fn(async () => [
      { id: "m1", role: "user", parts: [{ type: "text", text: "最近一条用户消息" }], createdAt: 1 },
      { id: "m2", role: "assistant", parts: [{ type: "text", text: "最近一条助手回复" }], createdAt: 2 },
    ]),
  };
});

afterEach(() => {
  delete (window as unknown as Record<string, unknown>).innocencecode;
  cleanup();
});

describe("SessionRow", () => {
  it("悬停让位：时间 group-hover:hidden、操作区 group-hover:flex（内联不重叠）", () => {
    const { container } = renderRow();
    const time = container.querySelector("time")!;
    expect(time.className).toContain("group-hover:hidden");
    const actions = container.querySelector("li > span.hidden")!;
    expect(actions.className).toContain("group-hover:flex");
  });

  it("超长标题悬停后轮播（溢出量驱动内联变量）", () => {
    const { container } = renderRow();
    const title = container.querySelector(".truncate") as HTMLElement;
    // jsdom 无布局：手工定义溢出量（scrollWidth 300 > clientWidth 100）。
    Object.defineProperty(title, "scrollWidth", { configurable: true, value: 300 });
    Object.defineProperty(title, "clientWidth", { configurable: true, value: 100 });
    fireEvent.mouseEnter(container.querySelector("li")!);
    const marquee = container.querySelector(".marquee-title") as HTMLElement;
    expect(marquee).toBeTruthy();
    expect(marquee.style.getPropertyValue("--marquee-x")).toBe("-200px");
    // 鼠标离开回到省略号态。
    fireEvent.mouseLeave(container.querySelector("li")!);
    expect(container.querySelector(".marquee-title")).toBeNull();
  });

  it("悬停 350ms 出预览卡（最近一轮文本），离开消失", async () => {
    const { container } = renderRow();
    const row = container.querySelector("li")!;
    fireEvent.mouseEnter(row);
    await waitFor(() => expect(screen.getByText("最近一条用户消息")).toBeTruthy(), { timeout: 3000 });
    expect(screen.getByText("最近一条助手回复")).toBeTruthy();
    fireEvent.mouseLeave(row);
    await waitFor(() => expect(screen.queryByText("最近一条用户消息")).toBeNull());
  });

  it("无桥接时不出预览卡", async () => {
    delete (window as unknown as Record<string, unknown>).innocencecode;
    const { container } = renderRow();
    fireEvent.mouseEnter(container.querySelector("li")!);
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(screen.queryByText("最近一条用户消息")).toBeNull();
  });
});
