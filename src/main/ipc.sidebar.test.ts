import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  handles: new Map<string, (...args: unknown[]) => unknown>(),
  archiveSession: vi.fn(),
  reorderSessions: vi.fn(),
  moveSession: vi.fn(),
  reorderSidebarContainers: vi.fn(),
  broadcastSidebar: vi.fn(),
  generateAutomationCandidate: vi.fn(),
  confirmAutomation: vi.fn(),
  listAutomations: vi.fn(),
  triggerAutomation: vi.fn(),
}));

vi.mock("electron", () => ({
  app: { getVersion: vi.fn(), getLocale: vi.fn() },
  ipcMain: { handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => mocks.handles.set(channel, handler)) },
}));
vi.mock("./sessions", () => ({
  listSessions: vi.fn(), getSidebarState: vi.fn(), createSession: vi.fn(), deleteSession: vi.fn(), listMessages: vi.fn(), appendMessage: vi.fn(),
  archiveSession: mocks.archiveSession, reorderSessions: mocks.reorderSessions, moveSession: mocks.moveSession, reorderSidebarContainers: mocks.reorderSidebarContainers,
  upsertSidebarGroup: vi.fn(), deleteSidebarGroup: vi.fn(), setSidebarGroupCollapsed: vi.fn(),
}));
vi.mock("./harnessGlue", () => ({
  getCommittedHarnessSettings: vi.fn(), getHarnessSettings: vi.fn(), getPluginInventory: vi.fn(), generateAutomationCandidate: mocks.generateAutomationCandidate, confirmAutomation: mocks.confirmAutomation, listAutomations: mocks.listAutomations, triggerAutomation: mocks.triggerAutomation, listProviderModelsById: vi.fn(), pickWorkspace: vi.fn(), respondPermission: vi.fn(), sendChatTurn: vi.fn(), setHarnessSettings: vi.fn(), stopChatTurn: vi.fn(), updateProviderApiKey: vi.fn(), disposeSession: vi.fn(),
}));
vi.mock("./sessionEvents", () => ({ broadcastSessions: vi.fn(), broadcastSidebar: mocks.broadcastSidebar }));
vi.mock("./theme", () => ({ broadcastTheme: vi.fn(), getTheme: vi.fn(), setTheme: vi.fn() }));
vi.mock("./mcpImport", () => ({ discoverMcpFile: vi.fn(), importMcpServers: vi.fn(), parseMcpImport: vi.fn() }));
vi.mock("./mcpAuthorization", () => ({ authorizeWorkspaceRoot: vi.fn() }));
vi.mock("./skillDiscovery", () => ({ discoverExternalSkills: vi.fn(), importSkill: vi.fn() }));
vi.mock("./appWindow", () => ({ getMainWindow: vi.fn() }));
vi.mock("./menu", () => ({ popupMenu: vi.fn() }));
vi.mock("./logger", () => ({ logger: { info: vi.fn() } }));

import { IPC } from "../shared/ipc";
import { registerIpcHandlers } from "./ipc";

describe("sidebar mutation IPC durability", () => {
  beforeEach(() => {
    mocks.handles.clear();
    vi.clearAllMocks();
    registerIpcHandlers();
  });

  it("propagates a failed sidebar mutation without publishing sidebar state", () => {
    mocks.archiveSession.mockImplementation(() => { throw new Error("sidebar state was not saved"); });
    const handler = mocks.handles.get(IPC.sidebarArchive);

    expect(() => handler?.({}, "s1", true)).toThrow("sidebar state was not saved");
    expect(mocks.broadcastSidebar).not.toHaveBeenCalled();
  });

  it("routes automation candidate, confirmation, list, and trigger through typed handlers", async () => {
    mocks.generateAutomationCandidate.mockResolvedValue({ candidate: true });
    mocks.confirmAutomation.mockResolvedValue({ id: "automation-1" });
    mocks.listAutomations.mockResolvedValue([]);
    mocks.triggerAutomation.mockResolvedValue(undefined);

    await mocks.handles.get(IPC.automationCandidate)?.({}, "review tasks");
    await mocks.handles.get(IPC.automationConfirm)?.({}, { candidate: { ok: true }, name: "Review" });
    await mocks.handles.get(IPC.automationList)?.({});
    await mocks.handles.get(IPC.automationTrigger)?.({}, { id: "automation-1", trigger: "manual", sessionId: "s1", routeId: "main" });

    expect(mocks.generateAutomationCandidate).toHaveBeenCalledWith("review tasks");
    expect(mocks.confirmAutomation).toHaveBeenCalledWith({ ok: true }, "Review");
    expect(mocks.listAutomations).toHaveBeenCalledOnce();
    expect(mocks.triggerAutomation).toHaveBeenCalledWith({ id: "automation-1", trigger: "manual", sessionId: "s1", routeId: "main" });
  });
});
