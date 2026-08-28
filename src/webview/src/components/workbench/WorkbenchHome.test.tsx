// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkbenchHome } from "./WorkbenchHome";


afterEach(cleanup);

describe("WorkbenchHome", () => {
  it("shows four capability cards and switches to each target tab", () => {
    const onSelect = vi.fn();
    render(<WorkbenchHome onSelect={onSelect} />);

    expect(screen.getByRole("heading", { name: "工作台" })).toBeTruthy();
    expect(screen.getAllByRole("button").map((button) => button.textContent)).toEqual([
      "辅助对话",
      "审查",
      "终端",
      "浏览器",
    ]);

    fireEvent.click(screen.getByRole("button", { name: "审查" }));
    fireEvent.click(screen.getByRole("button", { name: "终端" }));
    fireEvent.click(screen.getByRole("button", { name: "浏览器" }));
    expect(onSelect.mock.calls).toEqual([["review"], ["terminal"], ["browser"]]);
  });

  it("uses injected copy and keeps the assistant card addressable", () => {
    const onSelect = vi.fn();
    render(
      <WorkbenchHome
        onSelect={onSelect}
        t={(key) => ({
          "workbench.home.title": "Workbench",
          "workbench.home.assistant": "Assistant",
          "workbench.home.review": "Review changes",
          "workbench.home.terminal": "Terminal",
          "workbench.home.browser": "Browser",
        }[key] ?? key)}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Assistant" }));
    expect(onSelect).toHaveBeenCalledWith("assistant");
    expect(screen.getByRole("heading", { name: "Workbench" })).toBeTruthy();
  });
});
