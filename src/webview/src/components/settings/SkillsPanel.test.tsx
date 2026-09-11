// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SkillsPanel, type SkillsApi } from "./SkillsPanel";
import { zhCN } from "../../lib/i18n";
afterEach(cleanup);
const api = (): SkillsApi => ({
  subagentWorkspaces: vi.fn(async () => [{ root: "/project", name: "Project" }]),
  skillSettingsList: vi.fn(async () => [{ id: "review", name: "Review", description: "Review changes", enabled: true }]),
  skillSettingsEnable: vi.fn(async () => {}), skillSettingsRemove: vi.fn(async () => {}),
  skillSettingsDiscover: vi.fn(async () => []), skillSettingsImport: vi.fn(async () => {}),
});
it("toggles a skill, confirms deletion, and starts the creator in the selected scope", async () => {
  const bridge = api(); const create = vi.fn(async () => {});
  render(<SkillsPanel api={bridge} t={(key) => zhCN[key] ?? key} onCreate={create} />);
  fireEvent.click(await screen.findByRole("switch", { name: "启用 Review" }));
  await waitFor(() => expect(bridge.skillSettingsEnable).toHaveBeenCalledWith(null, "review", false));
  await waitFor(() => expect(screen.getByRole("button", { name: "删除 Review" })).not.toBeDisabled());
  fireEvent.click(screen.getByRole("button", { name: "删除 Review" }));
  expect(bridge.skillSettingsRemove).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "确认删除" }));
  await waitFor(() => expect(bridge.skillSettingsRemove).toHaveBeenCalledWith(null, "review"));
  await waitFor(() => expect(screen.getByRole("button", { name: "技能范围" })).not.toBeDisabled());
  fireEvent.click(screen.getByRole("button", { name: "技能范围" }));
  fireEvent.click(await screen.findByRole("button", { name: "Project" }));
  await waitFor(() => expect(bridge.skillSettingsList).toHaveBeenLastCalledWith("/project"));
  fireEvent.click(screen.getByRole("button", { name: "新建技能" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  await waitFor(() => expect(create).toHaveBeenCalledWith("/project"));
});
