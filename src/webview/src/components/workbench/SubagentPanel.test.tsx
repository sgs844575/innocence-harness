// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SubagentPanel } from "./SubagentPanel";

const child = {
  childId: "child-1",
  parentSessionId: "parent-1",
  description: "研究任务",
  status: "running" as const,
  text: "正在读取",
};

describe("SubagentPanel", () => {
  it("renders lifecycle text and status", () => {
    render(<SubagentPanel child={child} />);
    expect(screen.getByText("研究任务")).toBeTruthy();
    expect(screen.getByText("正在读取")).toBeTruthy();
    expect(screen.getByText("running")).toBeTruthy();
  });

  it("shows the error alongside partial text after a failed child run", () => {
    render(<SubagentPanel child={{ ...child, status: "failed", text: "已输出的部分", error: "模型请求失败" }} />);
    expect(screen.getByText("已输出的部分")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain("模型请求失败");
    expect(screen.getByText("失败")).toBeTruthy();
  });

});
