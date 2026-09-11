import path from "node:path";
import { exists, json, safePath } from "./files";

/** Default and manifest contributions share containment checks and deduplication. */
export async function bundleDocuments(root: string, fallback: string, configured: unknown): Promise<unknown[]> {
  const documents: unknown[] = [];
  const files = new Set<string>();
  const load = async (relative: string) => {
    const file = await safePath(root, relative);
    if (files.has(file)) return;
    files.add(file);
    documents.push(await json(file));
  };
  if (await exists(path.join(root, fallback))) await load(fallback);
  for (const value of configured === undefined ? [] : Array.isArray(configured) ? configured : [configured]) {
    if (typeof value === "string") await load(value);
    else if (value && typeof value === "object" && !Array.isArray(value)) documents.push(value);
    else throw new Error("Invalid component document declaration.");
  }
  return documents;
}
