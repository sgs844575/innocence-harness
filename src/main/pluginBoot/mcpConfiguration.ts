import { listMcpServers } from "@innocenceharness/plugin-mcp/settings";
import type { InnocenceConfig } from "@innocenceharness/harness-permissions";

/** Project entries override user entries, including disabled overrides. */
export async function loadMcpSessionConfig(workspace: string, userRoot: string, loadProject: (root: string) => Promise<InnocenceConfig>): Promise<InnocenceConfig> {
  const [project, user] = await Promise.all([loadProject(workspace), listMcpServers({ directory: userRoot })]);
  return { ...project, mcpServers: { ...user, ...project.mcpServers } as InnocenceConfig["mcpServers"] };
}
