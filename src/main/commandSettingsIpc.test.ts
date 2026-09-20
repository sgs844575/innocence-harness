import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => Promise<unknown>>(),
  discover: vi.fn(),
  importCommand: vi.fn(),
  settings: { workspaceRoot: "" } as { workspaceRoot: string; externalSkillDiscovery?: boolean },
  inventory: [] as { id: string; title: string; state: string }[],
}));
vi.mock("electron", () => ({ app: { isPackaged: false }, ipcMain: { handle: (channel: string, handler: (...args: unknown[]) => unknown) => mocks.handlers.set(channel, async (...args) => handler(...args)) } }));
vi.mock("./appDataRoot", () => ({ appDataRoot: () => dataRoot }));
vi.mock("./sessions", () => ({ listSessions: () => [] }));
vi.mock("./harnessGlue", () => ({
  getHarnessSettings: () => mocks.settings,
  getPluginInventory: async () => mocks.inventory,
  bootPaths: () => ({ builtinRoot }),
}));
vi.mock("./pluginBoot/compose", () => ({ defaultUserPluginRoot: () => userPluginRoot }));
vi.mock("./testOverrides", () => ({ currentTestOverrides: () => ({ enabled: false }) }));
vi.mock("./commandDiscovery", () => ({ discoverExternalCommands: mocks.discover, importCommand: mocks.importCommand }));
import { registerCommandSettingsIpc } from "./commandSettingsIpc";

let home: string;
let dataRoot: string;
let userPluginRoot: string;
let builtinRoot: string;
const projectDir = () => mocks.settings.workspaceRoot;

beforeAll(async () => {
  home = await fs.mkdtemp(path.join(os.tmpdir(), "innocence-command-ipc-"));
  dataRoot = path.join(home, "data");
  userPluginRoot = path.join(home, "plugins");
  builtinRoot = path.join(home, "builtin");
  mocks.settings.workspaceRoot = path.join(home, "project");
  await fs.mkdir(path.join(mocks.settings.workspaceRoot, ".innocence", "commands"), { recursive: true });
  await fs.writeFile(path.join(mocks.settings.workspaceRoot, ".innocence", "commands", "proj.md"), "---\nname: proj\ndescription: 项目命令\n---\n正文", "utf8");
  await fs.mkdir(path.join(userPluginRoot, "my-plugin", "commands"), { recursive: true });
  await fs.writeFile(path.join(userPluginRoot, "my-plugin", "commands", "hello.md"), "---\nname: hello\ndescription: 问好\n---\n正文", "utf8");
  await fs.mkdir(path.join(builtinRoot, "team", "commands"), { recursive: true });
  await fs.writeFile(path.join(builtinRoot, "team", "commands", "standup.md"), "Plain body without frontmatter.", "utf8");
  await fs.mkdir(path.join(builtinRoot, "off", "commands"), { recursive: true });
  await fs.writeFile(path.join(builtinRoot, "off", "commands", "ghost.md"), "---\nname: ghost\ndescription: g\n---\n", "utf8");
});
afterAll(async () => { await fs.rm(home, { recursive: true, force: true }); });
beforeEach(() => {
  mocks.handlers.clear(); mocks.discover.mockReset(); mocks.importCommand.mockReset();
  mocks.inventory = [
    { id: "my-plugin", title: "My Plugin", state: "active" },
    { id: "team", title: "Team", state: "active" },
    { id: "off", title: "Off", state: "disabled-by-config" },
  ];
  delete mocks.settings.externalSkillDiscovery;
  registerCommandSettingsIpc();
});

it("lists installed commands per scope plus active plugin groups (degraded entries fall back to the filename)", async () => {
  const userScope = await mocks.handlers.get("command-settings:list")!(null, null) as { installed: { id: string }[]; plugins: { id: string; title: string; commands: { name: string; description: string }[] }[] };
  expect(userScope.installed).toEqual([]);
  expect(userScope.plugins).toEqual([
    { id: "my-plugin", title: "My Plugin", commands: [{ name: "hello", description: "问好" }] },
    { id: "team", title: "Team", commands: [{ name: "standup", description: "" }] },
  ]);
  const projectScope = await mocks.handlers.get("command-settings:list")!(null, projectDir()) as { installed: { id: string; name: string }[] };
  expect(projectScope.installed.map((row) => row.id)).toEqual(["proj"]);
  await expect(mocks.handlers.get("command-settings:list")!(null, "/unknown")).rejects.toThrow("Unknown command workspace");
});

it("creates and removes commands only in the selected scope, rejecting invalid input", async () => {
  await mocks.handlers.get("command-settings:create")!(null, projectDir(), { id: "new-cmd", description: "新建", body: "正文" });
  expect(await fs.readFile(path.join(projectDir(), ".innocence", "commands", "new-cmd.md"), "utf8")).toContain("name: \"new-cmd\"");
  await expect(mocks.handlers.get("command-settings:create")!(null, projectDir(), { id: "bad", description: " ", body: "" })).rejects.toThrow("Invalid command definition");
  await expect(mocks.handlers.get("command-settings:create")!(null, projectDir(), { id: "../evil", description: "d", body: "" })).rejects.toThrow();
  await mocks.handlers.get("command-settings:remove")!(null, projectDir(), "new-cmd");
  await expect(fs.stat(path.join(projectDir(), ".innocence", "commands", "new-cmd.md"))).rejects.toThrow();
});

it("discovers per scope, marks installed rows imported, and honors the external-discovery gate", async () => {
  const user = { name: "proj", description: "d", sourceFile: "/external/user/proj.md", origin: "external-a", imported: false };
  const project = { name: "only-project", description: "d", sourceFile: "/external/project/only.md", origin: "external-b", imported: false };
  mocks.discover.mockImplementation(async (root?: string) => root ? [project] : [user]);
  const found = await mocks.handlers.get("command-settings:discover")!(null, projectDir()) as { name: string; imported: boolean }[];
  expect(found).toEqual([{ ...user, imported: true }, project]);
  mocks.settings.externalSkillDiscovery = false;
  expect(await mocks.handlers.get("command-settings:discover")!(null, projectDir())).toEqual([]);
});

it("imports a discovered command into the selected scope and refuses unavailable sources", async () => {
  const command = { name: "only-project", description: "d", sourceFile: "/external/project/only.md", origin: "external-b", imported: false };
  mocks.discover.mockImplementation(async (root?: string) => root ? [command] : []);
  await mocks.handlers.get("command-settings:import")!(null, projectDir(), command.sourceFile);
  expect(mocks.importCommand).toHaveBeenCalledWith(command, path.join(projectDir(), ".innocence", "commands"), projectDir());
  await expect(mocks.handlers.get("command-settings:import")!(null, projectDir(), "/external/gone.md")).rejects.toThrow("unavailable or already imported");
});
