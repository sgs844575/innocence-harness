import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => Promise<unknown>>(),
  discover: vi.fn(),
  copy: vi.fn(),
  inventory: vi.fn(async () => [] as { id: string; title: string; state: string }[]),
}));
vi.mock("electron", () => ({ app: { isPackaged: false }, ipcMain: { handle: (channel: string, handler: never) => mocks.handlers.set(channel, handler) } }));
vi.mock("./appDataRoot", () => ({ appDataRoot: () => "/user" }));
vi.mock("./sessions", () => ({ listSessions: () => [] }));
vi.mock("./harnessGlue", () => ({
  getHarnessSettings: () => ({ workspaceRoot: "/project" }),
  getPluginInventory: mocks.inventory,
  bootPaths: () => ({ builtinRoot: path.join(fixtureRoot, "builtin") }),
}));
vi.mock("./pluginBoot/compose", () => ({ defaultUserPluginRoot: () => path.join(fixtureRoot, "plugins") }));
vi.mock("./testOverrides", () => ({ currentTestOverrides: () => ({}) }));
vi.mock("./skillDiscovery", () => ({ discoverExternalSkills: mocks.discover }));
vi.mock("@innocenceharness/plugin-skills/management", () => ({ listManagedSkills: async () => [], setSkillEnabled: vi.fn(), removeManagedSkill: vi.fn(), copyManagedSkill: mocks.copy }));
import { registerSkillSettingsIpc } from "./skillSettingsIpc";

let fixtureRoot = "";
beforeAll(() => {
  fixtureRoot = mkdtempSync(path.join(tmpdir(), "skill-plugins-"));
  // 激活插件的技能贡献；停用插件的技能必须不出现。
  const skillDir = path.join(fixtureRoot, "plugins", "team-x", "skills", "review-kit");
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(path.join(skillDir, "SKILL.md"), "---\nname: review-kit\ndescription: Review helpers for teams\n---\n\nBody.", "utf8");
  const hiddenDir = path.join(fixtureRoot, "plugins", "off", "skills", "hidden");
  mkdirSync(hiddenDir, { recursive: true });
  writeFileSync(path.join(hiddenDir, "SKILL.md"), "---\nname: hidden\ndescription: Hidden skill\n---\n\nBody.", "utf8");
});
afterAll(() => {
  rmSync(fixtureRoot, { recursive: true, force: true });
});
beforeEach(() => {
  mocks.handlers.clear();
  mocks.discover.mockReset();
  mocks.copy.mockReset();
  mocks.inventory.mockReset();
  mocks.inventory.mockResolvedValue([]);
  registerSkillSettingsIpc();
});
it("offers user skills for project imports and writes only to the selected destination", async () => {
  const skill = { name: "sample", sourceDir: "/external/sample", description: "Sample", origin: "external", imported: false };
  mocks.discover.mockImplementation(async (root?: string) => root ? [] : [skill]);
  expect(await mocks.handlers.get("skill-settings:discover")!(null, "/project")).toEqual([skill]);
  await mocks.handlers.get("skill-settings:import")!(null, "/project", skill.sourceDir);
  expect(mocks.copy).toHaveBeenCalledWith(path.join("/project", ".innocence", "skills"), skill.sourceDir, skill.name);
  await expect(mocks.handlers.get("skill-settings:discover")!(null, "/unknown")).rejects.toThrow("Unknown skill workspace");
});
it("lists plugin-contributed skills as read-only groups from active plugins only", async () => {
  mocks.inventory.mockResolvedValue([
    { id: "team-x", title: "Team X", state: "active" },
    { id: "off", title: "Off", state: "disabled-by-config" },
    { id: "bare", title: "Bare", state: "active" },
  ]);
  const groups = await mocks.handlers.get("skill-settings:plugins")!(null) as { id: string; title: string; skills: { name: string; description: string }[] }[];
  // 停用插件不出现；无技能目录的激活插件不产生空组。
  expect(groups).toEqual([
    { id: "team-x", title: "Team X", skills: [{ name: "review-kit", description: "Review helpers for teams" }] },
  ]);
});
