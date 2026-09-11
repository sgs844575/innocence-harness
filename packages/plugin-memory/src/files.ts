import fs from "node:fs/promises";
import path from "node:path";

export interface MemoryFile {
  name: string;
  path: string;
  updatedAt: number;
  size: number;
}

export const MAX_MEMORY_FILE_BYTES = 1_000_000;

export function validMemoryId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 200 &&
    value.trim() === value && !value.startsWith(".") && !value.endsWith(".") &&
    !/[\\/:*?"<>|\x00-\x1f]/.test(value) &&
    !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(value);
}

/** Roots are host supplied; reject linked storage directories and entry files. */
export async function memoryDirectory(root: string, create = false): Promise<string> {
  if (!root || !path.isAbsolute(root)) throw new Error("Memory root is not configured.");
  const directory = path.join(root, "memory");
  for (const candidate of [root, directory]) {
    if (create) await fs.mkdir(candidate, { recursive: true });
    const stat = await fs.lstat(candidate);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error("Memory directory must be a regular directory.");
  }
  return directory;
}

export async function resolveMemoryFile(root: string, name: string): Promise<MemoryFile> {
  if (typeof name !== "string" || !name.endsWith(".md") || !validMemoryId(name.slice(0, -3))) {
    throw new Error("Invalid memory file name.");
  }
  const file = path.join(await memoryDirectory(root), name);
  const stat = await fs.lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Memory entry must be a regular file.");
  return { name, path: file, updatedAt: stat.mtimeMs, size: stat.size };
}

export async function listMemoryFiles(root: string): Promise<MemoryFile[]> {
  let directory: string;
  try {
    directory = await memoryDirectory(root);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const files: MemoryFile[] = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".md") || !validMemoryId(entry.name.slice(0, -3))) continue;
    try { files.push(await resolveMemoryFile(root, entry.name)); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
  return files.sort((a, b) => a.name === "MEMORY.md" ? -1 : b.name === "MEMORY.md" ? 1 : a.name.localeCompare(b.name));
}

export async function readMemoryFile(root: string, name: string): Promise<MemoryFile & { content: string }> {
  const file = await resolveMemoryFile(root, name);
  if (file.size > MAX_MEMORY_FILE_BYTES) throw new Error("Memory file exceeds the 1 MB reading limit. Open it in an editor.");
  const handle = await fs.open(file.path, "r");
  try {
    const buffer = Buffer.alloc(MAX_MEMORY_FILE_BYTES + 1);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    if (bytesRead > MAX_MEMORY_FILE_BYTES) throw new Error("Memory file exceeds the 1 MB reading limit. Open it in an editor.");
    return { ...file, content: buffer.subarray(0, bytesRead).toString("utf8") };
  } finally { await handle.close(); }
}

export const memoryFiles = { list: listMemoryFiles, read: readMemoryFile, resolve: resolveMemoryFile };
export type MemoryFiles = typeof memoryFiles;
