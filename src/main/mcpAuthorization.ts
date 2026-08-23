import fs from "node:fs/promises";

const UNAUTHORIZED_ROOT = "mcp workspace root is not authorized";

export async function authorizeWorkspaceRoot(
  candidate: string,
  configuredRoot: string,
): Promise<string> {
  if (!candidate || !configuredRoot) throw new Error(UNAUTHORIZED_ROOT);

  try {
    const [candidateRoot, configuredWorkspaceRoot] = await Promise.all([
      fs.realpath(candidate),
      fs.realpath(configuredRoot),
    ]);
    if (candidateRoot !== configuredWorkspaceRoot) throw new Error(UNAUTHORIZED_ROOT);
    return candidateRoot;
  } catch {
    throw new Error(UNAUTHORIZED_ROOT);
  }
}
