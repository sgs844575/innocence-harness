import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { EditorCatalog, EditorIpcApi, InstalledEditor } from "../shared/editorIpc";
import type { EditorInstallation } from "./editorDiscovery";
import { launchEditorFile, launchEditorTarget, parseEditorCommand } from "./externalEditor";

interface EditorPreferences { externalEditorId?: string; externalEditorCommand?: string }
interface EditorServicePorts {
  discover(): Promise<EditorInstallation[]>;
  getPreferences(): EditorPreferences;
  savePreferences(preferences: EditorPreferences): Promise<unknown>;
  getSessionRoot(id: string): string | undefined;
  getWorkspaceRoots(): readonly string[];
  getIcon(file: string): Promise<string | undefined>;
  openDirectory(root: string): Promise<void>;
  revealFile(file: string): void;
  launch?: (command: string, target: string) => ReturnType<typeof launchEditorFile>;
  launchTarget?: typeof launchEditorTarget;
}

function commandFor(installation: EditorInstallation): string {
  // Discovery supplies executable paths; application arguments are separate tokens.
  return [installation.executable, ...(installation.args ?? [])].map((part) => `"${part}"`).join(" ");
}

export function createEditorService(ports: EditorServicePorts): EditorIpcApi & { openFile(file: string): Promise<void> } {
  let installations: Map<string, { option: InstalledEditor; command: string; installation: EditorInstallation }> | undefined;
  let pending: Promise<void> | undefined;
  const key = (value: string) => process.platform === "win32" ? value.toLowerCase() : value;
  const inventory = async (refresh = false) => {
    if (installations && !refresh) return installations;
    if (!pending && (!installations || refresh)) {
      pending = (async () => {
        const discovered = await ports.discover();
        const entries = await Promise.all(discovered.map(async (installation) => {
          const command = commandFor(installation);
          const id = createHash("sha256").update(key(command)).digest("hex");
          const icon = await ports.getIcon(installation.iconPath ?? installation.executable).catch(() => undefined);
          return [id, { command, installation, option: { id, name: installation.name, kind: "editor" as const, icon } }] as const;
        }));
        installations = new Map(entries);
      })().finally(() => { pending = undefined; });
    }
    await pending;
    return installations!;
  };
  const catalog = async (refresh = false): Promise<EditorCatalog> => {
    const installed = await inventory(refresh);
    const preferences = ports.getPreferences();
    const editors: InstalledEditor[] = [{ id: "file-manager", name: "", kind: "fileManager" }, ...[...installed.values()].map(({ option }) => option)];
    let selectedId = preferences.externalEditorId?.trim() || undefined;
    const configured = preferences.externalEditorCommand?.trim();
    if (!selectedId && configured) {
      const parsed = parseEditorCommand(configured);
      const configuredFile = key(parsed.file);
      // Keep legacy command arguments intact until the user explicitly selects an installation.
      if (parsed.args.length === 0) selectedId = [...installed].find(([, item]) => key(item.installation.executable) === configuredFile)?.[0];
      if (!selectedId) {
        editors.push({ id: "custom", name: "", kind: "custom" });
        selectedId = "custom";
      }
    }
    if (selectedId === "custom" && configured && !editors.some(({ id }) => id === "custom")) editors.push({ id: "custom", name: "", kind: "custom" });
    // A removed selection falls back to the file manager, never an unrelated editor.
    if (selectedId && !editors.some(({ id }) => id === selectedId)) selectedId = "file-manager";
    return { editors, selectedId: selectedId ?? editors[1]?.id ?? "file-manager" };
  };
  const open = async (target: string, directory: boolean) => {
    const { selectedId } = await catalog();
    if (selectedId === "file-manager") {
      if (directory) await ports.openDirectory(target);
      else ports.revealFile(target);
      return;
    }
    const command = selectedId === "custom" ? ports.getPreferences().externalEditorCommand : installations?.get(selectedId)?.command;
    if (!command) throw new Error("The selected editor is unavailable. Refresh the editor list.");
    const installation = installations?.get(selectedId)?.installation;
    const result = installation
      ? await (ports.launchTarget ?? launchEditorTarget)(installation.executable, [...(installation.args ?? []), target])
      : await (ports.launch ?? launchEditorFile)(command, target);
    if (!result.launched) throw new Error(result.error || "The editor could not be opened.");
  };
  return {
    editorsList: catalog,
    async editorsSelect(id) {
      const available = await catalog();
      if (!available.editors.some((editor) => editor.id === id)) throw new Error("Unknown editor selection.");
      await ports.savePreferences({ externalEditorId: id, externalEditorCommand: id === "custom"
        ? ports.getPreferences().externalEditorCommand : installations?.get(id)?.command ?? "" });
      return catalog();
    },
    async editorOpenWorkspace(target) {
      let root: string | undefined;
      if (target && "sessionId" in target && typeof target.sessionId === "string") root = ports.getSessionRoot(target.sessionId);
      else if (target && "workspaceRoot" in target && typeof target.workspaceRoot === "string" && path.isAbsolute(target.workspaceRoot)) {
        root = ports.getWorkspaceRoots().find((candidate) => candidate && key(path.resolve(candidate)) === key(path.resolve(target.workspaceRoot)));
      }
      if (!root || !path.isAbsolute(root)) throw new Error("No active workspace is available.");
      const absolute = await fs.realpath(root);
      if (!(await fs.stat(absolute)).isDirectory()) throw new Error("The workspace is not a directory.");
      await open(absolute, true);
    },
    // Only authorized callers (such as the memory-file adapter) supply file paths.
    async openFile(file) { await open(file, false); },
  };
}
