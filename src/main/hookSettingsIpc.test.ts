import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { parse as parseYaml } from "yaml";
const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => Promise<unknown>>(),
  settings: { workspaceRoot: "" } as { workspaceRoot: string },
  inventory: [] as { id: string; title: string; state: string }[],
}));
vi.mock("electron", () => ({ app: { isPackaged: false }, ipcMain: { handle: (channel: string, handler: (...args: unknown[]) => unknown) => mocks.handlers.set(channel, async (...args) => handler(...args)) } }));
vi.mock("./sessions", () => ({ listSessions: () => [] }));
vi.mock("./harnessGlue", () => ({
  getHarnessSettings: () => mocks.settings,
  getPluginInventory: async () => mocks.inventory,
  bootPaths: () => ({ builtinRoot }),
}));
vi.mock("./pluginBoot/compose", () => ({ defaultUserPluginRoot: () => userPluginRoot }));
vi.mock("./testOverrides", () => ({ currentTestOverrides: () => ({ enabled: false }) }));
import { registerHookSettingsIpc } from "./hookSettingsIpc";

let home: string;
let userPluginRoot: string;
let builtinRoot: string;
let previousProfile: string | undefined;
let previousHome: string | undefined;
const projectDir = () => mocks.settings.workspaceRoot;
const userFile = () => path.join(home, ".innocence", "cordis.yml");
const projectFile = () => path.join(projectDir(), ".innocence", "plugins.yml");

beforeAll(async () => {
  home = await fs.mkdtemp(path.join(os.tmpdir(), "innocence-hook-ipc-"));
  userPluginRoot = path.join(home, "plugins");
  builtinRoot = path.join(home, "builtin");
  mocks.settings.workspaceRoot = path.join(home, "project");
  // 用户层文件走 os.homedir()（与组合根的 cordis.yml 读取同径）——覆盖
  // USERPROFILE/HOME 到临时 home，窗口含全部 IPC 调用。
  previousProfile = process.env.USERPROFILE;
  previousHome = process.env.HOME;
  process.env.USERPROFILE = home;
  process.env.HOME = home;
  await fs.mkdir(path.join(home, ".innocence"), { recursive: true });
  await fs.writeFile(
    userFile(),
    "plugins:\n  mcp: false\nhooks:\n  - event: sessionStart\n    command: node boot.js\n  - event: bogus\n    command: broken\n",
    "utf8",
  );
  await fs.mkdir(path.join(projectDir(), ".innocence"), { recursive: true });
  await fs.writeFile(projectFile(), "hooks:\n  - event: turnEnd\n    command: node done.js\n    timeoutMs: 5000\n", "utf8");
  // 插件分组：用户根 my-plugin 带两个 hooks/*.json（逐文件解析合并），内置根
  // team 一个；off 停用不出现。
  await fs.mkdir(path.join(userPluginRoot, "my-plugin", "hooks"), { recursive: true });
  await fs.writeFile(path.join(userPluginRoot, "my-plugin", "hooks", "hooks.json"), JSON.stringify({ PreToolUse: [{ matcher: "Read", hooks: [{ type: "command", command: "node guard.js" }] }] }), "utf8");
  await fs.writeFile(path.join(userPluginRoot, "my-plugin", "hooks", "extra.json"), JSON.stringify({ Stop: [{ hooks: [{ type: "command", command: "node wrap.js", timeout: 5 }] }] }), "utf8");
  await fs.writeFile(path.join(userPluginRoot, "my-plugin", "hooks", "broken.json"), "{ not json", "utf8");
  await fs.mkdir(path.join(builtinRoot, "team", "hooks"), { recursive: true });
  await fs.writeFile(path.join(builtinRoot, "team", "hooks", "hooks.json"), JSON.stringify({ SessionStart: [{ hooks: [{ type: "command", command: "node hi.js" }] }] }), "utf8");
  await fs.mkdir(path.join(builtinRoot, "off", "hooks"), { recursive: true });
  await fs.writeFile(path.join(builtinRoot, "off", "hooks", "hooks.json"), JSON.stringify({ SessionStart: [{ hooks: [{ type: "command", command: "node ghost.js" }] }] }), "utf8");
});
afterAll(async () => {
  if (previousProfile === undefined) delete process.env.USERPROFILE;
  else process.env.USERPROFILE = previousProfile;
  if (previousHome === undefined) delete process.env.HOME;
  else process.env.HOME = previousHome;
  await fs.rm(home, { recursive: true, force: true });
});
beforeEach(() => {
  mocks.handlers.clear();
  mocks.inventory = [
    { id: "my-plugin", title: "My Plugin", state: "active" },
    { id: "team", title: "Team", state: "active" },
    { id: "off", title: "Off", state: "disabled-by-config" },
  ];
  registerHookSettingsIpc();
});

it("lists layer-file hooks index-stably (invalid entries flagged) plus active plugin groups", async () => {
  const userScope = await mocks.handlers.get("hook-settings:list")!(null, null) as { installed: { index: number; valid: boolean; event: string; command: string; warning?: string }[]; plugins: { id: string; hooks: { event: string; command: string; match?: string; timeoutMs?: number }[] }[] };
  expect(userScope.installed).toEqual([
    { index: 0, valid: true, event: "sessionStart", command: "node boot.js" },
    { index: 1, valid: false, event: "bogus", command: "broken", warning: 'hooks[0]: unknown event "bogus"' },
  ]);
  expect(userScope.plugins).toEqual([
    { id: "my-plugin", title: "My Plugin", hooks: [
      { event: "turnEnd", command: "node wrap.js", commandTokens: ["node", "wrap.js"], timeoutMs: 5000 },
      { event: "preToolCall", command: "node guard.js", commandTokens: ["node", "guard.js"], match: "Read", matchKind: "regex" },
    ] },
    { id: "team", title: "Team", hooks: [{ event: "sessionStart", command: "node hi.js", commandTokens: ["node", "hi.js"] }] },
  ]);
  const projectScope = await mocks.handlers.get("hook-settings:list")!(null, projectDir()) as { installed: { event: string; timeoutMs?: number }[] };
  expect(projectScope.installed).toEqual([{ index: 0, valid: true, event: "turnEnd", command: "node done.js", timeoutMs: 5000 }]);
  await expect(mocks.handlers.get("hook-settings:list")!(null, "/unknown")).rejects.toThrow("Unknown hook workspace");
});

it("appends validated definitions (extra fields dropped) and rejects invalid input", async () => {
  await mocks.handlers.get("hook-settings:create")!(null, projectDir(), { event: "postToolCall", command: "node check.js", match: "Write", extra: "dropped" });
  const doc = parseYaml(await fs.readFile(projectFile(), "utf8"));
  expect(doc.hooks).toEqual([
    { event: "turnEnd", command: "node done.js", timeoutMs: 5000 },
    { event: "postToolCall", command: "node check.js", match: "Write" },
  ]);
  await expect(mocks.handlers.get("hook-settings:create")!(null, projectDir(), { event: "nope", command: "x" })).rejects.toThrow("unknown event");
  await expect(mocks.handlers.get("hook-settings:create")!(null, projectDir(), { event: "turnEnd", command: " " })).rejects.toThrow("non-empty");
});

it("removes by original index with bounds check; last removal drops the key", async () => {
  await mocks.handlers.get("hook-settings:remove")!(null, null, 0);
  let doc = parseYaml(await fs.readFile(userFile(), "utf8"));
  expect(doc.hooks).toEqual([{ event: "bogus", command: "broken" }]);
  await expect(mocks.handlers.get("hook-settings:remove")!(null, null, 5)).rejects.toThrow("out of range");
  await mocks.handlers.get("hook-settings:remove")!(null, null, 0);
  doc = parseYaml(await fs.readFile(userFile(), "utf8"));
  expect(doc).toEqual({ plugins: { mcp: false } });
});

it("refuses to manage a corrupt layer file", async () => {
  await fs.writeFile(projectFile(), "hooks: [unbalanced\n", "utf8");
  await expect(mocks.handlers.get("hook-settings:list")!(null, projectDir())).rejects.toThrow("not parseable");
  await fs.writeFile(projectFile(), "hooks:\n  - event: turnEnd\n    command: node done.js\n    timeoutMs: 5000\n", "utf8");
});
