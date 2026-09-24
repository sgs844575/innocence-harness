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
  skillSettingsPlugins: vi.fn(async () => []),
});
it("renders plugin-contributed skills as a read-only group without switches", async () => {
  const bridge = {
    ...api(),
    skillSettingsPlugins: vi.fn(async () => [
      { id: "team-x", title: "Team X", skills: [{ name: "review-kit", description: "Review helpers" }] },
      { id: "empty", title: "Empty", skills: [] },
    ]),
  };
  render(<SkillsPanel api={bridge} t={(key) => zhCN[key] ?? key} />);
  expect(await screen.findByTestId("skills-plugin-groups")).toBeTruthy();
  expect(screen.getByText("Team X")).toBeTruthy();
  expect(screen.getByText("review-kit")).toBeTruthy();
  expect(screen.getByText("Review helpers")).toBeTruthy();
  // 空组不渲染；插件技能行无开关/删除面（只读）。
  expect(screen.queryByText("Empty")).toBeNull();
  expect(screen.queryByRole("switch", { name: "启用 review-kit" })).toBeNull();
  expect(screen.queryByRole("button", { name: "删除 review-kit" })).toBeNull();
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
