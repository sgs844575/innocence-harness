import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { expect, it } from "vitest";
import { saveMcpServer } from "@innocenceharness/plugin-mcp/settings";
import { loadMcpSessionConfig } from "./mcpConfiguration";
import { createMcpSettingsService } from "../mcpSettingsService";

it("stores user servers in the data root and merges project overrides into production configuration", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "mcp-user-"));
  try {
    const service = createMcpSettingsService(() => [], () => root);
    await service.mcpSettingsSave(null, "shared", { command: "run", timeout: 30000 }, true);
    await saveMcpServer({ directory: root }, "remote", { url: "https://example.test" }, true);
    expect((await service.mcpSettingsList(null)).shared.timeout).toBe(30000);
    expect(await fs.stat(path.join(root, "config.json"))).toBeTruthy();
    const result = await loadMcpSessionConfig("project", root, async () => ({ permissions: { allow: ["Read"] }, mcpServers: { shared: { command: "project", disabled: true } } }));
    expect(result.mcpServers).toMatchObject({ remote: { url: "https://example.test" }, shared: { command: "project", disabled: true } });
    expect(result.permissions).toEqual({ allow: ["Read"] });
    const imported = await service.mcpSettingsImport(null, '{"second":{"command":"run"}}');
    expect(imported.imported).toEqual(["second"]);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
