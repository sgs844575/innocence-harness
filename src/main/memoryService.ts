import path from "node:path";
import type { MemoryFiles } from "@innocenceharness/plugin-memory";
import type { MemoryIpcApi, MemoryOpenAction, MemoryTarget } from "../shared/memoryIpc";

interface MemoryServicePorts {
  getWorkspaceRoots(): readonly string[];
  getDataRoot(): string;
  loadFiles(): Promise<MemoryFiles>;
  openFile(file: string, action: MemoryOpenAction): Promise<void>;
}

/** File operations remain in the staged capability; this adapter authorizes host targets. */
export function createMemoryService(ports: MemoryServicePorts): MemoryIpcApi {
  const key = (root: string) => process.platform === "win32" ? root.toLowerCase() : root;
  const workspaces = () => {
    const roots = new Map<string, string>();
    for (const candidate of ports.getWorkspaceRoots()) {
      if (!candidate || !path.isAbsolute(candidate)) continue;
      const root = path.resolve(candidate);
      if (!roots.has(key(root))) roots.set(key(root), root);
    }
    return [...roots.values()].map((root) => ({ root, name: path.basename(root) || root }));
  };
  const resolveRoot = (target: MemoryTarget) => {
    if (target === null) return ports.getDataRoot();
    if (typeof target !== "string" || !path.isAbsolute(target)) throw new Error("Unknown memory workspace.");
    const workspace = workspaces().find(({ root }) => key(root) === key(path.resolve(target)));
    if (!workspace) throw new Error("Unknown memory workspace.");
    return path.join(workspace.root, ".innocence");
  };
  return {
    async memoryWorkspaces() { return workspaces(); },
    async memoryFiles(target) {
      const root = resolveRoot(target);
      return (await ports.loadFiles()).list(root);
    },
    async memoryReadFile(target, name) {
      const root = resolveRoot(target);
      return (await ports.loadFiles()).read(root, name);
    },
    async memoryOpenFile(target, name, action) {
      if (!["editor", "default", "reveal"].includes(action)) throw new Error("Unknown memory file action.");
      const root = resolveRoot(target);
      const file = await (await ports.loadFiles()).resolve(root, name);
      await ports.openFile(file.path, action);
    },
  };
}
