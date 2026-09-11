import { expect, it, vi } from "vitest";
import path from "node:path";
import { createMcpSettingsService } from "./mcpSettingsService";

it("lists distinct known workspaces and refuses unknown targets before touching files", async () => {
  const root = path.resolve("known-project");
  const service = createMcpSettingsService(vi.fn(() => [root, root, ""]));
  expect(await service.mcpSettingsWorkspaces()).toEqual([{ root, name: "known-project" }]);
  await expect(service.mcpSettingsList(path.resolve("unknown-project"))).rejects.toThrow("Unknown workspace");
  await expect(service.mcpSettingsSave("relative", "server", { command: "run" }, true)).rejects.toThrow("Unknown workspace");
});
