import path from "node:path";
import type { PresetCatalog } from "@innocenceharness/plugin-subagent";
import type { SubagentSettingsApi } from "../shared/subagentIpc";

export function createSubagentSettingsService(ports: {
  getDataRoot(): string;
  getWorkspaceRoots(): readonly string[];
  loadCatalog(): Promise<PresetCatalog>;
}): SubagentSettingsApi {
  const key = (root: string) => process.platform === "win32" ? root.toLowerCase() : root;
  const workspaces = () => [...new Map(ports.getWorkspaceRoots().filter((root) => root && path.isAbsolute(root)).map((root) => [key(path.resolve(root)), path.resolve(root)])).values()].map((root) => ({ root, name: path.basename(root) || root }));
  const projectRoot = (target: string | null) => {
    if (target === null) return undefined;
    if (typeof target !== "string" || !path.isAbsolute(target)) throw new Error("Unknown subagent workspace.");
    const entry = workspaces().find(({ root }) => key(root) === key(path.resolve(target)));
    if (!entry) throw new Error("Unknown subagent workspace.");
    return path.join(entry.root, ".innocence");
  };
  return {
    async subagentWorkspaces() { return workspaces(); },
    async subagentCatalog(target) {
      const project = projectRoot(target);
      return (await ports.loadCatalog()).list(ports.getDataRoot(), project);
    },
    async subagentSave(target, preset, create) {
      const root = projectRoot(target) ?? ports.getDataRoot();
      if (typeof create !== "boolean") throw new Error("Invalid save operation.");
      await (await ports.loadCatalog()).save(root, preset, create);
    },
    async subagentRemove(target, id) {
      const root = projectRoot(target) ?? ports.getDataRoot();
      await (await ports.loadCatalog()).remove(root, id);
    },
  };
}
