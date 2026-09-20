// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { WorkbenchView } from "./WorkbenchView";
import type { WorkbenchApi } from "../../../../shared/workbenchIpc";
import { zhCN } from "../../lib/i18n";
afterEach(cleanup);

const demo = { id: "demo", name: "演示面板", createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z", dir: "/data/workbench/demo" };

const api = (overrides?: Partial<WorkbenchApi>): WorkbenchApi & { changed(payload: { id: string }): void } => {
  const listeners = new Set<(payload: { id: string }) => void>();
  return {
    workbenchList: vi.fn(async () => [demo]),
    workbenchCreate: vi.fn(async () => demo),
    workbenchRemove: vi.fn(async () => {}),
    workbenchWatch: vi.fn(async () => {}),
    workbenchUnwatch: vi.fn(async () => {}),
    onWorkbenchChanged: vi.fn((cb: (payload: { id: string }) => void) => { listeners.add(cb); return () => listeners.delete(cb); }),
    changed: (payload: { id: string }) => { listeners.forEach((cb) => cb(payload)); },
    ...overrides,
  };
};
const t = (key: string) => zhCN[key] ?? key;

it("lists workbenches, deletes with inline confirm, and reports unavailability without a bridge", async () => {
  const bridge = api();
  const { unmount } = render(<WorkbenchView t={t} api={bridge} onOpenChat={() => {}} onBack={() => {}} />);
  expect(await screen.findByText("演示面板")).toBeTruthy();
  expect(screen.getByRole("heading", { name: "工作台" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "删除 演示面板" }));
  expect(bridge.workbenchRemove).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "确认删除" }));
  await waitFor(() => expect(bridge.workbenchRemove).toHaveBeenCalledWith("demo"));
  unmount();
  render(<WorkbenchView t={t} onOpenChat={() => {}} onBack={() => {}} />);
  expect(await screen.findByText("当前环境不支持工作台。")).toBeTruthy();
});

it("creates through the dialog and opens a chat with the English bootstrap prompt only when described", async () => {
  const bridge = api({ workbenchList: vi.fn(async () => []) });
  const openChat = vi.fn();
  const first = render(<WorkbenchView t={t} api={bridge} onOpenChat={openChat} onBack={() => {}} />);
  expect(await screen.findByText("还没有工作台")).toBeTruthy();
  expect(screen.getByText("通过对话让 Agent 为你搭建专属工作台。")).toBeTruthy();
  const buttons = screen.getAllByRole("button", { name: "新建工作台" });
  fireEvent.click(buttons[buttons.length - 1]);
  const dialog = await screen.findByRole("dialog");
  fireEvent.change(within(dialog).getByLabelText("名称"), { target: { value: "面板" } });
  fireEvent.change(within(dialog).getByLabelText("需求描述"), { target: { value: "a tiny clock" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "创建" }));
  await waitFor(() => expect(bridge.workbenchCreate).toHaveBeenCalledWith("面板"));
  await waitFor(() => expect(openChat).toHaveBeenCalledWith("/data/workbench/demo", expect.stringMatching(/^Build a personal workbench app in this directory:.*Requirement: a tiny clock$/s)));
  // 无描述 → 不带引导 prompt。
  first.unmount();
  openChat.mockClear();
  vi.mocked(bridge.workbenchCreate).mockClear();
  render(<WorkbenchView t={t} api={bridge} onOpenChat={openChat} onBack={() => {}} />);
  fireEvent.click((await screen.findAllByRole("button", { name: "新建工作台" })).at(-1)!);
  const dialog2 = await screen.findByRole("dialog");
  fireEvent.change(within(dialog2).getByLabelText("名称"), { target: { value: "面板" } });
  fireEvent.click(within(dialog2).getByRole("button", { name: "创建" }));
  await waitFor(() => expect(openChat).toHaveBeenCalledWith("/data/workbench/demo", undefined));
});

it("run mode renders the sandboxed iframe and hot-reloads on workbench:changed", async () => {
  const bridge = api();
  render(<WorkbenchView t={t} api={bridge} onOpenChat={() => {}} onBack={() => {}} />);
  fireEvent.click(await screen.findByRole("button", { name: "打开" }));
  const frame = await screen.findByTitle("演示面板");
  expect(frame.getAttribute("sandbox")).toBe("allow-scripts");
  expect(frame.getAttribute("src")).toBe("innocenceharness-workbench://demo/index.html?v=0");
  await waitFor(() => expect(bridge.workbenchWatch).toHaveBeenCalledWith("demo"));
  bridge.changed({ id: "other" });
  expect(frame.getAttribute("src")).toBe("innocenceharness-workbench://demo/index.html?v=0");
  bridge.changed({ id: "demo" });
  await waitFor(() => expect(frame.getAttribute("src")).toBe("innocenceharness-workbench://demo/index.html?v=1"));
  // 手动刷新 + 返回列表时释放监听。
  fireEvent.click(screen.getByRole("button", { name: "刷新" }));
  await waitFor(() => expect(frame.getAttribute("src")).toBe("innocenceharness-workbench://demo/index.html?v=2"));
  fireEvent.click(screen.getByRole("button", { name: "返回" }));
  await waitFor(() => expect(bridge.workbenchUnwatch).toHaveBeenCalledWith("demo"));
  expect(await screen.findByText("演示面板")).toBeTruthy();
});
