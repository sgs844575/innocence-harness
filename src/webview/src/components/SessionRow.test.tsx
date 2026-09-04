// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
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

afterEach(() => {
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

  it("置顶会话行首显示 Pin 图标，静态圆点消失", () => {
    const { container } = renderRow({ pinned: true });
    expect(container.querySelector(".lucide-pin")).toBeTruthy();
    expect(container.querySelector(".rounded-full.border")).toBeNull();
  });

  it("置顶 + 运行态时转圈优先于 Pin 图标", () => {
    const { container } = renderRow({ pinned: true, running: true });
    expect(container.querySelector(".animate-spin")).toBeTruthy();
    expect(container.querySelector(".lucide-pin")).toBeNull();
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
});
