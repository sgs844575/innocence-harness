// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { HooksPanel, type HooksApi } from "./HooksPanel";
import { zhCN } from "../../lib/i18n";
afterEach(cleanup);
const api = (overrides?: Partial<HooksApi>): HooksApi => ({
  subagentWorkspaces: vi.fn(async () => [{ root: "/project", name: "Project" }]),
  hookSettingsList: vi.fn(async () => ({
    installed: [
      { index: 0, valid: true, event: "sessionStart", command: "node boot.js", timeoutMs: 5000 },
      { index: 1, valid: false, event: "bogus", command: "broken", warning: "unknown event" },
    ],
    plugins: [{ id: "acme-tools", title: "Acme Tools", hooks: [{ event: "turnEnd" as const, command: "node done.js" }] }],
  })),
  hookSettingsCreate: vi.fn(async () => {}),
  hookSettingsRemove: vi.fn(async () => {}),
  ...overrides,
});
const t = (key: string) => zhCN[key] ?? key;

it("renders installed rows (invalid flagged) and plugin groups, deletes by index, switches scope", async () => {
  const bridge = api();
  render(<HooksPanel api={bridge} t={t} />);
  expect(await screen.findByText("sessionStart")).toBeTruthy();
  expect(screen.getByRole("heading", { name: "钩子" })).toBeTruthy();
  expect(screen.getByText("项目级钩子整体覆盖用户级钩子。")).toBeTruthy();
  expect(screen.getByText("无效条目")).toBeTruthy();
  expect(screen.getByText("Acme Tools")).toBeTruthy();
  expect(screen.getByText("turnEnd")).toBeTruthy();
  expect(screen.queryByRole("button", { name: /删除 turnEnd/ })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "删除 sessionStart #0" }));
  expect(bridge.hookSettingsRemove).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "确认删除" }));
  await waitFor(() => expect(bridge.hookSettingsRemove).toHaveBeenCalledWith(null, 0));
  await waitFor(() => expect(screen.getByRole("button", { name: "钩子范围" })).not.toBeDisabled());
  fireEvent.click(screen.getByRole("button", { name: "钩子范围" }));
  fireEvent.click(await screen.findByRole("button", { name: "Project" }));
  await waitFor(() => expect(bridge.hookSettingsList).toHaveBeenLastCalledWith("/project"));
});

it("filters installed rows and plugin groups by the search query", async () => {
  render(<HooksPanel api={api()} t={t} />);
  await screen.findByText("sessionStart");
  const search = screen.getByLabelText("搜索钩子…");
  fireEvent.change(search, { target: { value: "done" } });
  expect(screen.queryByText("sessionStart")).toBeNull();
  expect(screen.getByText("turnEnd")).toBeTruthy();
  fireEvent.change(search, { target: { value: "zzz" } });
  expect(screen.queryByText("turnEnd")).toBeNull();
  expect(screen.queryByText("Acme Tools")).toBeNull();
  expect(screen.getByText("没有匹配的钩子。")).toBeTruthy();
});

it("shows the dashed empty state and validates the create form before submitting", async () => {
  const bridge = api({ hookSettingsList: vi.fn(async () => ({ installed: [], plugins: [] })) });
  render(<HooksPanel api={bridge} t={t} />);
  expect(await screen.findByText("尚未安装钩子")).toBeTruthy();
  expect(screen.getByText("新建钩子，以在任务生命周期事件中运行命令。")).toBeTruthy();
  const buttons = screen.getAllByRole("button", { name: "新建" });
  fireEvent.click(buttons[buttons.length - 1]);
  const dialog = await screen.findByRole("dialog");
  // 空白命令 + 超限超时 → 表单校验错误，不提交。
  fireEvent.change(within(dialog).getByLabelText("命令"), { target: { value: " " } });
  fireEvent.change(within(dialog).getByLabelText("超时（毫秒）"), { target: { value: "99999" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "新建" }));
  expect(await within(dialog).findByRole("alert")).toBeTruthy();
  expect(bridge.hookSettingsCreate).not.toHaveBeenCalled();
  // 选事件 + 填命令 + 合法超时 → 提交校验后的定义。
  fireEvent.click(within(dialog).getByRole("button", { name: "事件" }));
  fireEvent.click(await screen.findByRole("button", { name: "postToolCall" }));
  fireEvent.change(within(dialog).getByLabelText("命令"), { target: { value: "node check.js" } });
  fireEvent.change(within(dialog).getByLabelText("超时（毫秒）"), { target: { value: "5000" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "新建" }));
  await waitFor(() => expect(bridge.hookSettingsCreate).toHaveBeenCalledWith(null, { event: "postToolCall", command: "node check.js", timeoutMs: 5000 }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
});
