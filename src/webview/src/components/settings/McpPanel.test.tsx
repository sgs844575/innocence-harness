// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { McpPanel } from "./McpPanel";
import { zhCN } from "../../lib/i18n";
import type { McpSettingsApi } from "../../../../shared/mcpSettingsIpc";
afterEach(cleanup);
const t = (key: string) => zhCN[key] ?? key;
const api = (): McpSettingsApi => ({
  mcpSettingsWorkspaces: vi.fn(async () => [{ root: "/project", name: "Project" }]),
  mcpSettingsList: vi.fn(async () => ({ local: { command: "run" } })),
  mcpSettingsSave: vi.fn(async () => {}),
  mcpSettingsImport: vi.fn(async () => ({ imported: ["remote"], skipped: [] })),
});
it("toggles persisted enablement and confirms deletion", async () => {
  const bridge = api(); render(<McpPanel api={bridge} t={t} />);
  await screen.findByText("local");
  fireEvent.click(screen.getByRole("switch", { name: "已启用 local" }));
  await waitFor(() => expect(bridge.mcpSettingsSave).toHaveBeenCalledWith(null, "local", { command: "run", disabled: true }, false));
  await waitFor(() => expect(screen.getByRole("button", { name: "local" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "local" }));
  fireEvent.click(screen.getByRole("button", { name: "删除" }));
  fireEvent.click(screen.getByRole("button", { name: "确认删除" }));
  await waitFor(() => expect(bridge.mcpSettingsSave).toHaveBeenCalledWith(null, "local", null, false));
});
it("keeps the editor and draft after a rejected save", async () => {
  const bridge = api(); bridge.mcpSettingsSave = vi.fn(async () => { throw new Error("write denied"); });
  render(<McpPanel api={bridge} t={t} />); await screen.findByText("local");
  fireEvent.click(screen.getByRole("button", { name: "local" }));
  fireEvent.click(screen.getByRole("button", { name: "JSON" }));
  fireEvent.change(screen.getByLabelText("完整配置", { exact: false }), { target: { value: '{"local":{"url":"https://example.test"}}' } });
  fireEvent.click(screen.getByRole("button", { name: "保存" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("write denied");
  expect(screen.getByLabelText("完整配置", { exact: false })).toHaveValue('{"local":{"url":"https://example.test"}}');
});

it("round trips form fields through JSON and saves to the selected scope", async () => {
  const bridge = api(); render(<McpPanel api={bridge} t={t} />);
  await screen.findByText("local");
  fireEvent.click(screen.getByRole("button", { name: "新建" }));
  fireEvent.change(screen.getByLabelText("服务名称"), { target: { value: "new-server" } });
  fireEvent.change(screen.getByLabelText("命令"), { target: { value: "runner" } });
  fireEvent.change(screen.getByLabelText("参数（JSON 数组，保留空格与路径）"), { target: { value: '["a b", "C:\\u005cwork"]' } });
  fireEvent.click(screen.getByRole("button", { name: "JSON" }));
  const json = screen.getByLabelText("完整配置", { exact: false }) as HTMLTextAreaElement;
  expect(JSON.parse(json.value)["new-server"].args[0]).toBe("a b");
  fireEvent.click(screen.getByRole("button", { name: "表单" }));
  expect(screen.getByLabelText("命令")).toHaveValue("runner");
  fireEvent.click(screen.getByRole("button", { name: "作用域" }));
  fireEvent.click(screen.getByRole("button", { name: "Project" }));
  fireEvent.click(screen.getByRole("button", { name: "保存" }));
  await waitFor(() => expect(bridge.mcpSettingsImport).toHaveBeenCalledWith("/project", expect.stringContaining('"new-server"')));
});
