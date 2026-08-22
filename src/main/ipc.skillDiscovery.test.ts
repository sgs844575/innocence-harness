// Main IPC security gate: disabling external discovery must return before the
// filesystem discovery function is called.
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  handles: new Map<string, (...args: unknown[]) => unknown>(),
  discoverExternalSkills: vi.fn(),
  getHarnessSettings: vi.fn(),
}));
const { handles, discoverExternalSkills, getHarnessSettings } = mocks;

vi.mock("electron", () => ({
  app: { getVersion: vi.fn(), getLocale: vi.fn() },
  ipcMain: { handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => handles.set(channel, handler)) },
}));
vi.mock("./skillDiscovery", () => ({ discoverExternalSkills: mocks.discoverExternalSkills, importSkill: vi.fn() }));
vi.mock("./mcpImport", () => ({ discoverMcpFile: vi.fn(), importMcpServers: vi.fn(), parseMcpImport: vi.fn() }));
vi.mock("./mcpAuthorization", () => ({ authorizeWorkspaceRoot: vi.fn() }));
vi.mock("./theme", () => ({ broadcastTheme: vi.fn(), getTheme: vi.fn(), setTheme: vi.fn() }));
vi.mock("./sessions", () => ({
  listSessions: vi.fn(), createSession: vi.fn(), deleteSession: vi.fn(), listMessages: vi.fn(), appendMessage: vi.fn(),
}));
vi.mock("./harnessGlue", () => ({
  getHarnessSettings: mocks.getHarnessSettings,
  getPluginInventory: vi.fn(), listProviderModels: vi.fn(), pickWorkspace: vi.fn(), respondPermission: vi.fn(),
  sendChatTurn: vi.fn(), setHarnessSettings: vi.fn(), stopChatTurn: vi.fn(), disposeSession: vi.fn(),
}));
vi.mock("./appWindow", () => ({ getMainWindow: vi.fn() }));
vi.mock("./menu", () => ({ popupMenu: vi.fn() }));
vi.mock("./logger", () => ({ logger: { info: vi.fn() } }));
vi.mock("./sessionEvents", () => ({ broadcastSessions: vi.fn() }));

import { IPC } from "../shared/ipc";
import { registerIpcHandlers } from "./ipc";

describe("skills:discover IPC handler", () => {
  beforeEach(() => {
    handles.clear();
    vi.clearAllMocks();
  });

  it("returns an empty list without scanning when external discovery is disabled", async () => {
    getHarnessSettings.mockReturnValue({ externalSkillDiscovery: false });
    registerIpcHandlers();

    const handler = handles.get(IPC.skillsDiscover);
    expect(handler).toBeDefined();
    expect(handler?.()).toEqual([]);
    expect(discoverExternalSkills).not.toHaveBeenCalled();
  });
});
