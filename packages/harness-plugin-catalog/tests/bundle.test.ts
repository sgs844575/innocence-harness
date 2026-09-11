import { afterEach, beforeEach, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { inspectPlugin, readBundleAgents, readBundleServers, readBundleHooks, readBundleLanguageServers } from "../src/index";
let root: string;
beforeEach(async () => { root = await mkdtemp(path.join(os.tmpdir(), "bundle-")); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });
async function write(file: string, body: string | object) {
  await mkdir(path.dirname(path.join(root, file)), { recursive: true });
  await writeFile(path.join(root, file), typeof body === "string" ? body : JSON.stringify(body), "utf8");
}
it("loads inline and custom hooks once and makes hook-only bundles installable", async () => {
  const document = { hooks: { Stop: [{ hooks: [{ type: "command", command: "node finish.js" }] }] } };
  await write("hooks/hooks.json", document);
  await write("custom.json", document);
  const manifest = { name: "hooks-only", hooks: ["./hooks/hooks.json", "custom.json", document] };
  await write(".codex-plugin/plugin.json", manifest);
  expect((await readBundleHooks(root, manifest)).hooks).toHaveLength(3);
  expect(await inspectPlugin(root)).toMatchObject({ installable: true, components: ["hooks"], unsupported: [] });
  await expect(readBundleHooks(root, { hooks: "../outside.json" })).rejects.toThrow();
});
it("loads language server declarations and reports unsupported options", async () => {
  const server = { command: "node", args: ["${PLUGIN_ROOT}/server.js"], extensionToLanguage: { ".TS": "typescript" }, initializationOptions: { mode: "check" }, settings: { lint: true } };
  await write(".codex-plugin/plugin.json", { name: "language-only", lspServers: { checker: server } });
  expect(await inspectPlugin(root)).toMatchObject({ installable: true, components: ["lspServers"], unsupported: [] });
  const loaded = await readBundleLanguageServers(root, { lspServers: { checker: server, bad: { ...server, transport: "socket" } } }, { root, data: root, env: {} });
  expect(loaded.servers.checker).toMatchObject({ args: [`${root}/server.js`], extensionToLanguage: { ".ts": "typescript" }, initializationOptions: { mode: "check" }, settings: { lint: true } });
  expect(loaded.issues).toHaveLength(1);
});
it("preserves explicit authorization options and rejects invalid or unknown options", async () => {
  const oauth = { clientId: "registered-client", callbackPort: 8765, authServerMetadataUrl: "https://auth.example/metadata", scopes: ["read"] };
  const loaded = await readBundleServers(root, { mcpServers: { remote: { url: "https://tools.example/mcp", oauth }, invalid: { url: "https://tools.example/mcp", oauth: null }, unknown: { url: "https://tools.example/mcp", oauth: { secret: "unsupported" } } } });
  expect(loaded.servers.remote).toMatchObject({ oauth });
  expect(loaded.issues).toHaveLength(2);
});
it("reads default, custom and inline server maps with runtime substitutions and isolated failures", async () => {
  await write(".mcp.json", { mcp_servers: { local: { command: "node", args: ["${PLUGIN_ROOT}/server.mjs"], env: { TOKEN: "${TOKEN}", CACHE: "${CLAUDE_PLUGIN_DATA}" } } } });
  await write("extra.json", { remote: { type: "sse", url: "https://tools.example.org/mcp", headers: { Authorization: "Bearer ${TOKEN}" } } });
  const manifest = { mcpServers: ["./extra.json", { mcpServers: { broken: { url: "file:///tmp" }, optional: { command: "runner", env: { MODE: "${MODE:-safe}" } } } }] };
  const result = await readBundleServers(root, manifest, { root, data: "/persistent", env: { TOKEN: "test-token" } });
  expect(result.servers.local).toMatchObject({ command: "node", args: [`${root}/server.mjs`], cwd: root, env: { TOKEN: "test-token", CACHE: "/persistent" } });
  expect(result.servers.remote).toMatchObject({ type: "sse", headers: { Authorization: "Bearer test-token" } });
  expect(result.servers.optional).toMatchObject({ env: { MODE: "safe" } });
  expect(result.issues).toHaveLength(1);
  expect((await readBundleServers(root, {}, { root, data: "/persistent", env: {} })).issues[0].detail).toBe("Missing environment variable: TOKEN");
  await expect(readBundleServers(root, { mcpServers: "../outside.json" })).rejects.toThrow("leaves");
});
it("makes server-only bundles installable without resolving credentials or starting a process", async () => {
  await write(".codex-plugin/plugin.json", { name: "remote-tools" });
  await write(".mcp.json", { mcpServers: { remote: { url: "https://${HOST}/mcp", headers: { Authorization: "${TOKEN}" } } } });
  expect(await inspectPlugin(root)).toMatchObject({ installable: true, components: ["mcpServers"], unsupported: [] });
});
it("parses agent tool restrictions and skips unsupported options without granting broader access", async () => {
  await write(".codex-plugin/plugin.json", { name: "review" });
  await write("agents/review.md", "---\nname: reviewer\ndescription: Review changes\ntools: Read, Glob, mcp__search__find\ndisallowedTools: [Glob]\nmodel: inherit\n---\nReview without modifying files.");
  await write("agents/invalid.md", "---\nname: elevated\ndescription: Inspect\npermissionMode: bypassPermissions\n---\nInspect files.");
  const result = await readBundleAgents(root);
  expect(result.agents).toHaveLength(1);
  expect(result.agents[0]).toMatchObject({ tools: ["Read", "Glob", "mcp__search__find"], disallowedTools: ["Glob"] });
  expect(result.issues[0].detail).toContain("permissionMode");
  const metadata = await inspectPlugin(root);
  expect(metadata.components).toEqual(["agents"]);
  expect(metadata.unsupported[0]).toContain("permissionMode");
});
