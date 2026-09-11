import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ handlers: new Map<string, (...args: unknown[]) => Promise<unknown>>(), discover: vi.fn(), copy: vi.fn() }));
vi.mock("electron", () => ({ ipcMain: { handle: (channel: string, handler: never) => mocks.handlers.set(channel, handler) } }));
vi.mock("./appDataRoot", () => ({ appDataRoot: () => "/user" }));
vi.mock("./sessions", () => ({ listSessions: () => [] }));
vi.mock("./harnessGlue", () => ({ getHarnessSettings: () => ({ workspaceRoot: "/project" }) }));
vi.mock("./skillDiscovery", () => ({ discoverExternalSkills: mocks.discover }));
vi.mock("@innocenceharness/plugin-skills/management", () => ({ listManagedSkills: async () => [], setSkillEnabled: vi.fn(), removeManagedSkill: vi.fn(), copyManagedSkill: mocks.copy }));
import path from "node:path";
import { registerSkillSettingsIpc } from "./skillSettingsIpc";
beforeEach(() => { mocks.handlers.clear(); mocks.discover.mockReset(); mocks.copy.mockReset(); registerSkillSettingsIpc(); });
it("offers user skills for project imports and writes only to the selected destination", async () => {
  const skill = { name: "sample", sourceDir: "/external/sample", description: "Sample", origin: "external", imported: false };
  mocks.discover.mockImplementation(async (root?: string) => root ? [] : [skill]);
  expect(await mocks.handlers.get("skill-settings:discover")!(null, "/project")).toEqual([skill]);
  await mocks.handlers.get("skill-settings:import")!(null, "/project", skill.sourceDir);
  expect(mocks.copy).toHaveBeenCalledWith(path.join("/project", ".innocence", "skills"), skill.sourceDir, skill.name);
  await expect(mocks.handlers.get("skill-settings:discover")!(null, "/unknown")).rejects.toThrow("Unknown skill workspace");
});
