import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mergeSettings } from "@innocenceharness/harness-electron";
import { createEditorService } from "./editorService";
import { normalizeEditorInstallations, type EditorInstallation } from "./editorDiscovery";

let root: string;
beforeAll(async () => { root = await fs.mkdtemp(path.join(os.tmpdir(), "editor-targets-")); });
afterAll(async () => { await fs.rm(root, { recursive: true, force: true }); });

function fixture(initial: { externalEditorId?: string; externalEditorCommand?: string } = {}) {
  let preferences = initial;
  const installed: EditorInstallation[] = [
    { executable: "/opt/editor one/editor", name: "Editor One" },
    { executable: "/opt/editor two/editor", name: "Editor Two" },
  ];
  const ports = {
    discover: vi.fn(async () => installed),
    getPreferences: () => preferences,
    savePreferences: vi.fn(async (next) => { preferences = { ...preferences, ...next }; }),
    getSessionRoot: vi.fn((id: string) => id === "active" ? root : undefined),
    getWorkspaceRoots: () => [root],
    getIcon: vi.fn(async () => "data:image/png;base64,aWNvbg=="),
    openDirectory: vi.fn(async () => {}),
    revealFile: vi.fn(),
    launchTarget: vi.fn(async () => ({ launched: true })),
    launch: vi.fn(async () => ({ launched: true })),
  };
  return { service: createEditorService(ports), ports, installed, saved: () => preferences };
}

describe("installed editor service", () => {
  it("deduplicates executable paths and rejects invalid inventory entries", () => {
    expect(normalizeEditorInstallations([
      { executable: "C:\\Editors\\edit.exe", name: "Editor" },
      { executable: "c:\\editors\\EDIT.exe", name: "Duplicate" },
      { executable: "relative.exe", name: "Invalid" },
      { executable: "C:\\empty.exe", name: " " },
    ], "win32")).toEqual([{ executable: "C:\\Editors\\edit.exe", name: "Editor" }]);
    expect(() => normalizeEditorInstallations({})).toThrow("Invalid installed editor inventory");
  });

  it("shares one detection request, returns icons and persists the selected executable", async () => {
    const { service, ports, saved } = fixture({ externalEditorId: "", externalEditorCommand: "" });
    const [first, second] = await Promise.all([service.editorsList(), service.editorsList()]);
    expect(first).toEqual(second);
    expect(first.selectedId).toBe(first.editors[1].id);
    expect(ports.discover).toHaveBeenCalledTimes(1);
    expect(first.editors[1].icon).toMatch(/^data:image/);
    const chosen = first.editors[2];
    await service.editorsSelect(chosen.id);
    expect(saved()).toMatchObject({ externalEditorId: chosen.id, externalEditorCommand: '"/opt/editor two/editor"' });
    expect((await fixture(mergeSettings(saved())).service.editorsList()).selectedId).toBe(chosen.id);
    await service.editorOpenWorkspace({ sessionId: "active" });
    expect(ports.launchTarget).toHaveBeenCalledWith("/opt/editor two/editor", [await fs.realpath(root)]);
  });

  it("resolves session ownership at launch and never falls back to the global workspace", async () => {
    const { service, ports } = fixture();
    await expect(service.editorOpenWorkspace({ sessionId: "projectless" })).rejects.toThrow("No active workspace");
    await expect(service.editorOpenWorkspace({ workspaceRoot: os.tmpdir() })).rejects.toThrow("No active workspace");
    expect(ports.launchTarget).not.toHaveBeenCalled();
    await service.editorOpenWorkspace({ workspaceRoot: root });
    expect(ports.launchTarget).toHaveBeenCalledTimes(1);
  });

  it("uses the selected editor for an authorized file and preserves spaces and metacharacters", async () => {
    const { service, ports } = fixture();
    const file = path.join(root, "notes & drafts", "memory ; one.md");
    await service.openFile(file);
    expect(ports.launchTarget).toHaveBeenCalledWith("/opt/editor one/editor", [file]);
    expect(ports.openDirectory).not.toHaveBeenCalled();
  });

  it("opens the file manager for projects and reveals the exact memory file", async () => {
    const { service, ports } = fixture();
    await service.editorsSelect("file-manager");
    await service.editorOpenWorkspace({ sessionId: "active" });
    const file = path.join(root, "memory.md");
    await service.openFile(file);
    expect(ports.openDirectory).toHaveBeenCalledWith(await fs.realpath(root));
    expect(ports.revealFile).toHaveBeenCalledWith(file);
    expect(ports.launchTarget).not.toHaveBeenCalled();
  });

  it("refreshes installed editors and safely handles an uninstalled selection", async () => {
    const { service, ports } = fixture();
    await service.editorsSelect((await service.editorsList()).editors[1].id);
    ports.discover.mockResolvedValue([]);
    expect((await service.editorsList(true)).selectedId).toBe("file-manager");
    await expect(service.editorsSelect("unknown")).rejects.toThrow("Unknown editor");
    await service.openFile("/authorized/memory.md");
    expect(ports.revealFile).toHaveBeenCalledWith("/authorized/memory.md");
  });

  it("keeps custom commands and surfaces launch and persistence failures", async () => {
    const { service, ports } = fixture({ externalEditorCommand: '"/opt/editor one/editor" --wait' });
    expect((await service.editorsList()).selectedId).toBe("custom");
    await service.openFile("/authorized/file.md");
    expect(ports.launch).toHaveBeenCalledWith('"/opt/editor one/editor" --wait', "/authorized/file.md");
    expect(ports.launchTarget).not.toHaveBeenCalled();
    ports.savePreferences.mockRejectedValueOnce(new Error("Settings are read-only"));
    await expect(service.editorsSelect("file-manager")).rejects.toThrow("Settings are read-only");
    expect((await service.editorsList()).selectedId).toBe("custom");
    ports.launch.mockResolvedValueOnce({ launched: false });
    await expect(service.openFile("/authorized/file.md")).rejects.toThrow("could not be opened");
  });

  it("preserves structured application arguments and tolerates missing icons", async () => {
    const { service, ports } = fixture();
    ports.discover.mockResolvedValue([{ executable: "/usr/bin/open", name: "Editor", args: ["-a", "/Applications/Editor One.app"] }]);
    ports.getIcon.mockRejectedValue(new Error("No icon"));
    const catalog = await service.editorsList();
    expect(catalog.editors[1].icon).toBeUndefined();
    await service.openFile("/workspace/file.md");
    expect(ports.launchTarget).toHaveBeenCalledWith("/usr/bin/open", ["-a", "/Applications/Editor One.app", "/workspace/file.md"]);
  });
});
