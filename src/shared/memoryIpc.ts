export const MemoryIpcChannels = {
  memoryWorkspaces: "memory:workspaces",
  memoryFiles: "memory:files",
  memoryReadFile: "memory:read-file",
  memoryOpenFile: "memory:open-file",
} as const;

export interface MemoryWorkspace { root: string; name: string }
export interface MemoryFileInfo { name: string; path: string; updatedAt: number; size: number }
/** Null selects the user's global store, otherwise a known workspace. */
export type MemoryTarget = string | null;
export type MemoryOpenAction = "editor" | "default" | "reveal";

export interface MemoryIpcApi {
  memoryWorkspaces(): Promise<MemoryWorkspace[]>;
  memoryFiles(target: MemoryTarget): Promise<MemoryFileInfo[]>;
  memoryReadFile(target: MemoryTarget, name: string): Promise<MemoryFileInfo & { content: string }>;
  memoryOpenFile(target: MemoryTarget, name: string, action: MemoryOpenAction): Promise<void>;
}
