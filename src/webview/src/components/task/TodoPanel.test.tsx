// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TodoPanel } from "./TodoPanel";

afterEach(cleanup);

describe("TodoPanel", () => {
  it("renders only canonical Todo statuses with a progress summary", () => {
    render(
      <TodoPanel
        todos={[
          { content: "已完成步骤", status: "completed" },
          { content: "当前步骤", status: "in_progress" },
          { content: "待处理步骤", status: "pending" },
        ]}
        completed={1}
        total={3}
        pending={1}
      />,
    );

    expect(screen.getByText("已完成步骤")).toBeTruthy();
    expect(screen.getByText("当前步骤")).toBeTruthy();
    expect(screen.getByText("待处理步骤")).toBeTruthy();
    expect(screen.getByText("1/3")).toBeTruthy();
  });

  it("keeps the workbench open callback compatible", () => {
    const onOpen = vi.fn();
    render(<TodoPanel todos={[]} completed={0} total={0} pending={0} onOpen={onOpen} />);
    fireEvent.click(screen.getByRole("button", { name: "打开进程" }));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});
