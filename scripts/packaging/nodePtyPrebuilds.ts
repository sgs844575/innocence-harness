import fs from "node:fs/promises";
import path from "node:path";

export const NODE_PTY_KEEP_PLATFORM = "win32-x64";

const nodePtyPrebuildsRelativePath = path.join("node_modules", "node-pty", "prebuilds");

/**
 * Removes platform-specific node-pty prebuilds from a Forge staging tree.
 * The kept platform directory is intentionally never traversed or rewritten.
 */
export async function pruneNodePtyPrebuilds(stagingRoot: string): Promise<void> {
  const prebuildsRoot = path.join(stagingRoot, nodePtyPrebuildsRelativePath);
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(prebuildsRoot, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw new Error(`Unable to inspect node-pty prebuilds at ${prebuildsRoot}: ${String(error)}`, {
      cause: error,
    });
  }

  await Promise.all(
    entries
      .filter((entry) => entry.isDirectory() && entry.name !== NODE_PTY_KEEP_PLATFORM)
      .map(async (entry) => {
        const platformRoot = path.join(prebuildsRoot, entry.name);
        try {
          await fs.rm(platformRoot, { recursive: true, force: true });
        } catch (error) {
          throw new Error(`Unable to remove non-target node-pty prebuild ${platformRoot}: ${String(error)}`, {
            cause: error,
          });
        }
      }),
  );
}
