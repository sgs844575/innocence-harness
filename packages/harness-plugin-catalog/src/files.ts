import { lstat, mkdir, readFile, readdir, realpath, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

export function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
export function string(value: unknown): string { return typeof value === "string" ? value : ""; }
export function within(root: string, relative: string): string {
  if (typeof relative !== "string" || relative.includes("\0") || relative.includes(":") || relative.includes("\\")) throw new Error("Invalid relative path.");
  const full = path.resolve(root, relative);
  const rel = path.relative(root, full);
  if (rel === ".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) throw new Error("Path leaves the plugin root.");
  return full;
}
export async function safePath(root: string, relative: string): Promise<string> {
  const full = within(root, relative);
  const canonical = await realpath(full);
  within(await realpath(root), path.relative(await realpath(root), canonical).split(path.sep).join("/"));
  return full;
}
export async function json(file: string): Promise<unknown> {
  try { return JSON.parse(await readFile(file, "utf8")); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
}
export async function atomicJson(file: string, data: unknown): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${randomUUID()}.tmp`;
  try { await writeFile(temp, JSON.stringify(data, null, 2), "utf8"); await rename(temp, file); }
  finally { await rm(temp, { force: true }); }
}
export async function exists(file: string): Promise<boolean> {
  try { await lstat(file); return true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; }
}
/** Reject links and special files before copying a downloaded tree into a loadable root. */
export async function validateTree(root: string): Promise<void> {
  const visit = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.name === ".git") continue;
      if (entry.isSymbolicLink() || (!entry.isDirectory() && !entry.isFile())) throw new Error("Plugin contains a link or special file.");
      if (entry.isDirectory()) await visit(path.join(dir, entry.name));
    }
  };
  await visit(root);
}
