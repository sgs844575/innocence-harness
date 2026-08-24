import fs from "node:fs/promises";
import path from "node:path";

export const NODE_PTY_KEEP_PLATFORM = "win32-x64";

const nodePtyPrebuildsRelativePath = path.join("node_modules", "node-pty", "prebuilds");

export interface NodePtyPruneOptions {
  remove?: (target: string) => Promise<void>;
}

/**
 * Removes platform-specific node-pty prebuilds from a Forge staging tree.
 * The kept platform directory is intentionally never traversed or rewritten.
 */
export async function pruneNodePtyPrebuilds(
  stagingRoot: string,
  options: NodePtyPruneOptions = {},
): Promise<void> {
  const prebuildsRoot = path.join(stagingRoot, nodePtyPrebuildsRelativePath);
  const remove = options.remove ?? (async (target: string) => fs.rm(target, { recursive: true, force: true }));
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
          await remove(platformRoot);
        } catch (error) {
          throw new Error(`Unable to remove non-target node-pty prebuild ${platformRoot}: ${String(error)}`, {
            cause: error,
          });
        }
      }),
  );
}
