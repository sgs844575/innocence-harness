// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { CommandsPanel, type CommandsApi } from "./CommandsPanel";
import { zhCN } from "../../lib/i18n";
afterEach(cleanup);
const api = (overrides?: Partial<CommandsApi>): CommandsApi => ({
  subagentWorkspaces: vi.fn(async () => [{ root: "/project", name: "Project" }]),
  commandSettingsList: vi.fn(async () => ({
    installed: [{ id: "review", name: "review", description: "审查变更" }],
    plugins: [{ id: "acme-tools", title: "Acme Tools", commands: [{ name: "standup", description: "站会摘要" }] }],
  })),
  commandSettingsCreate: vi.fn(async () => {}),
  commandSettingsRemove: vi.fn(async () => {}),
  commandSettingsDiscover: vi.fn(async () => []),
  commandSettingsImport: vi.fn(async () => {}),
  ...overrides,
});
const t = (key: string) => zhCN[key] ?? key;

it("renders installed rows and plugin groups, confirms deletion inline, and switches scope", async () => {
  const bridge = api();
  render(<CommandsPanel api={bridge} t={t} />);
  expect(await screen.findByText("/review")).toBeTruthy();
  expect(screen.getByRole("heading", { name: "命令" })).toBeTruthy();
  expect(screen.getByText("已安装")).toBeTruthy();
  // 插件分组：标题 + 只读 /name 行（无删除按钮）。
  expect(screen.getByText("Acme Tools")).toBeTruthy();
  expect(screen.getByText("/standup")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "删除 standup" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "删除 review" }));
  expect(bridge.commandSettingsRemove).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "确认删除" }));
  await waitFor(() => expect(bridge.commandSettingsRemove).toHaveBeenCalledWith(null, "review"));
  await waitFor(() => expect(screen.getByRole("button", { name: "命令范围" })).not.toBeDisabled());
  fireEvent.click(screen.getByRole("button", { name: "命令范围" }));
  fireEvent.click(await screen.findByRole("button", { name: "Project" }));
  await waitFor(() => expect(bridge.commandSettingsList).toHaveBeenLastCalledWith("/project"));
});

it("filters installed rows and plugin groups by the search query", async () => {
  render(<CommandsPanel api={api()} t={t} />);
  await screen.findByText("/review");
  const search = screen.getByLabelText("搜索命令…");
  fireEvent.change(search, { target: { value: "standup" } });
  expect(screen.queryByText("/review")).toBeNull();
  expect(screen.getByText("/standup")).toBeTruthy();
  fireEvent.change(search, { target: { value: "zzz" } });
  expect(screen.queryByText("/standup")).toBeNull();
  expect(screen.queryByText("Acme Tools")).toBeNull();
  expect(screen.getByText("没有匹配的命令。")).toBeTruthy();
});

it("shows the dashed empty state and creates a command from it", async () => {
  const bridge = api({ commandSettingsList: vi.fn(async () => ({ installed: [], plugins: [] })) });
  render(<CommandsPanel api={bridge} t={t} />);
  expect(await screen.findByText("尚未安装命令")).toBeTruthy();
  expect(screen.getByText("新建命令，或从外部 Agent 导入已有命令。")).toBeTruthy();
  const buttons = screen.getAllByRole("button", { name: "新建" });
  fireEvent.click(buttons[buttons.length - 1]);
  const dialog = await screen.findByRole("dialog");
  fireEvent.change(within(dialog).getByLabelText("名称"), { target: { value: "Bad_Name" } });
  fireEvent.change(within(dialog).getByLabelText("描述"), { target: { value: "演示" } });
  fireEvent.change(within(dialog).getByLabelText("内容"), { target: { value: "正文" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "新建" }));
  expect(await within(dialog).findByRole("alert")).toBeTruthy();
  expect(bridge.commandSettingsCreate).not.toHaveBeenCalled();
  fireEvent.change(within(dialog).getByLabelText("名称"), { target: { value: "good-name" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "新建" }));
  await waitFor(() => expect(bridge.commandSettingsCreate).toHaveBeenCalledWith(null, { id: "good-name", description: "演示", body: "正文" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
});
