import { expect, it } from "vitest";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { AgentSession } from "@innocenceharness/harness-electron";
import { createMockProvider } from "@innocenceharness/provider-mock";
import { createSessionComposition } from "./sessionComposition";
import { stagingBootPaths } from "../staging-paths";
import { bundleServerName } from "./bundleCapabilities";

it.skipIf(!existsSync(stagingBootPaths().kernelPath))("loads bundled servers and agent presets through staging and excludes both when disabled", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "bundle-runtime-"));
  const dir = path.join(root, "plugins", "fixture");
  await mkdir(path.join(dir, ".codex-plugin"), { recursive: true });
  await mkdir(path.join(dir, "agents"));
  await writeFile(path.join(dir, ".codex-plugin/plugin.json"), JSON.stringify({ name: "fixture" }), "utf8");
  await writeFile(path.join(dir, ".mcp.json"), JSON.stringify({ echo: { command: process.execPath, args: [path.resolve("packages/plugin-mcp/tests/fixtures/echo-server.mjs")] } }), "utf8");
  await writeFile(path.join(dir, ".lsp.json"), JSON.stringify({ checker: { command: process.execPath, args: ["${PLUGIN_ROOT}/server.js"], extensionToLanguage: { ".ts": "typescript" } } }), "utf8");
  await writeFile(path.join(dir, "agents/review.md"), "---\nname: review\ndescription: Review files\ntools: Read\n---\nReview the files without editing.", "utf8");
  const composition = createSessionComposition({ resolvePaths: stagingBootPaths, getWorkspaceRoot: () => undefined,
    getUserPluginRoot: () => path.join(root, "plugins"), getMemoryUserRoot: () => path.join(root, "state"),
    getPluginDataRoot: () => path.join(root, "data"), enableHmrWatcher: false, log: () => {} });
  try {
    const boot = await composition.ensureBoot();
    for (const enabled of [true, false]) {
      const languages = await composition.bundleLanguageServers("", { fixture: enabled });
      expect(languages).toHaveLength(enabled ? 1 : 0);
      if (enabled) expect(languages[0]).toMatchObject({ id: bundleServerName("fixture", "checker"), args: [`${dir}/server.js`] });
      const chats: unknown[] = [];
      const session = await AgentSession.create({ scope: boot.createSessionScope(), spine: boot.spine,
        plugins: await composition.composePlugins("", { fixture: enabled }),
        provider: createMockProvider({ turns: [{ text: "done" }], onChat: (request) => chats.push(request) }),
        workspaceRoot: "", permission: { mode: "auto", decider: { ask: async () => "deny" } }, logger: () => {} });
      try {
        await session.run("Describe the available tools.");
        const sent = JSON.stringify(chats);
        expect(sent.includes(`mcp__${bundleServerName("fixture", "echo")}__echo`)).toBe(enabled);
        expect(sent.includes("bundle:fixture:review")).toBe(enabled);
      } finally { await session.dispose(); }
    }
  } finally { await composition.disposePluginBoot(); await rm(root, { recursive: true, force: true }); }
});
