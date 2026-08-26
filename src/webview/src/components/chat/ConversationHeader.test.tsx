// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConversationHeader } from "./ConversationHeader";

afterEach(cleanup);

describe("ConversationHeader", () => {
  it("renders task, project, and branch context", () => {
    render(<ConversationHeader task="Build the desktop shell" project="InnocenceCode" branch="main" />);
    expect(screen.getByRole("heading", { name: "Build the desktop shell" })).toBeTruthy();
    expect(screen.getByText("InnocenceCode")).toBeTruthy();
    expect(screen.getByText("main")).toBeTruthy();
  });

  it("offers injected typed actions through the more menu", async () => {
    const onOpenReview = vi.fn();
    render(<ConversationHeader task="Task" project="Project" branch="main" actions={[{ label: "打开审查", onSelect: onOpenReview }]} />);
    const more = screen.getByRole("button", { name: "更多聊天操作" });
    fireEvent.pointerDown(more, { button: 0, ctrlKey: false });
    fireEvent.pointerUp(more, { button: 0 });
    await waitFor(() => expect(screen.getByRole("menuitem", { name: "打开审查" })).toBeTruthy());
    fireEvent.click(screen.getByRole("menuitem", { name: "打开审查" }));
    expect(onOpenReview).toHaveBeenCalledOnce();
  });

  it("explains why the more control is unavailable when no action is injected", () => {
    render(<ConversationHeader task="Task" project="Project" branch="main" />);
    const more = screen.getByRole("button", { name: "更多聊天操作" });
    expect(more.hasAttribute("disabled")).toBe(true);
    expect(more.getAttribute("aria-description")).toMatch(/没有可用聊天操作/);
  });
});
