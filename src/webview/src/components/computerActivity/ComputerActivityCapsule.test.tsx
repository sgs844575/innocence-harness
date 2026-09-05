// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ComputerActivityCapsule } from "./ComputerActivityCapsule";
import type { ComputerActivityViewState } from "../../../../shared/computerActivity";

afterEach(cleanup);
const state: ComputerActivityViewState = {
  theme: "dark", locale: "zh-CN",
  activity: { toolName: "computer_type", status: "running", activeCount: 1, startedAt: Date.now(), canStop: true },
};

it("renders the action, retries a failed stop, and forwards pointer boundaries", async () => {
  const onStop = vi.fn().mockRejectedValueOnce(new Error("busy")).mockResolvedValue(undefined);
  const onHover = vi.fn();
  render(<ComputerActivityCapsule state={state} onStop={onStop} onHover={onHover} />);
  expect(screen.getByText("输入文字")).toBeTruthy();
  const capsule = screen.getByTestId("computer-activity-capsule");
  fireEvent.pointerEnter(capsule);
  expect(onHover).toHaveBeenLastCalledWith(true);
  fireEvent.pointerLeave(capsule);
  expect(onHover).toHaveBeenLastCalledWith(false);
  const button = screen.getByRole("button", { name: "停止电脑操作及相关任务" });
  fireEvent.click(button);
  await screen.findByText("停止失败，请重试");
  fireEvent.click(button);
  await waitFor(() => expect(onStop).toHaveBeenCalledTimes(2));
});

it("displays concurrent work and terminal outcomes, and removes idle content", () => {
  const props = { onStop: vi.fn(), onHover: vi.fn() };
  const { rerender } = render(<ComputerActivityCapsule {...props} state={{ ...state, activity: { ...state.activity!, activeCount: 2 } }} />);
  expect(screen.getByText("2 个操作进行中")).toBeTruthy();
  for (const [status, label] of [["success", "电脑操作已完成"], ["error", "电脑操作失败"], ["cancelled", "电脑操作已停止"]] as const) {
    rerender(<ComputerActivityCapsule {...props} state={{ ...state, activity: { ...state.activity!, status } }} />);
    expect(screen.getByText(label)).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  }
  rerender(<ComputerActivityCapsule {...props} state={{ ...state, activity: null }} />);
  expect(screen.queryByTestId("computer-activity-capsule")).toBeNull();
});

it("uses the shared dictionary when switching languages", () => {
  const props = { onStop: vi.fn(), onHover: vi.fn() };
  const { rerender } = render(<ComputerActivityCapsule {...props} state={state} />);
  expect(screen.getByText("正在操作电脑")).toBeTruthy();
  rerender(<ComputerActivityCapsule {...props} state={{ ...state, locale: "en-US" }} />);
  expect(screen.getByText("Controlling computer")).toBeTruthy();
  expect(screen.getByText("Typing")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Stop computer actions and related tasks" })).toBeTruthy();
  expect(screen.queryByText("正在操作电脑")).toBeNull();
});
