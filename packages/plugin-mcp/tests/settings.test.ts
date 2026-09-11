import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { importMcpServers, listMcpServers, parseMcpImport, saveMcpServer } from "../src/settings";
import { isMcpServerEntry } from "../src/config";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))); });
async function fixture() { const root = await fs.mkdtemp(path.join(os.tmpdir(), "mcp-settings-")); roots.push(root); return root; }

it("validates each transport and rejects ambiguous or malformed options", () => {
  for (const value of [{ command: "runner", args: ["a b"], disabled: true }, { url: "https://example.test/mcp", headers: { Authorization: "value" } }, { url: "wss://example.test" }, { url: "https://example.test", type: "sse", oauth: { clientId: "client" } }]) expect(isMcpServerEntry(value)).toBe(true);
  for (const value of [{ command: "" }, { url: "file:///tmp/test" }, { url: "https://example.test", command: "run" }, { url: "wss://example.test", type: "http" }, { command: "run", env: [] }, { command: "run", disabled: "false" }, { url: "https://example.test", oauth: { callbackPort: -1 } }]) expect(isMcpServerEntry(value)).toBe(false);
});

it("serializes edits and imports, preserves unrelated settings and rejects duplicate creates", async () => {
  const root = await fixture();
  await fs.mkdir(path.join(root, ".innocence"));
  await fs.writeFile(path.join(root, ".innocence/config.json"), JSON.stringify({ permissions: { allow: ["Read"] } }), "utf8");
  await Promise.all([saveMcpServer(root, "local", { command: "runner" }, true), importMcpServers({ remote: { url: "https://example.test" } }, root)]);
  expect(Object.keys(await listMcpServers(root))).toEqual(["local", "remote"]);
  await expect(saveMcpServer(root, "local", { command: "other" }, true)).rejects.toThrow("already exists");
  await saveMcpServer(root, "local", { command: "runner", disabled: true });
  expect((await listMcpServers(root)).local.disabled).toBe(true);
  await saveMcpServer(root, "local", null);
  expect(Object.keys(await listMcpServers(root))).toEqual(["remote"]);
  expect(JSON.parse(await fs.readFile(path.join(root, ".innocence/config.json"), "utf8")).permissions).toEqual({ allow: ["Read"] });
});

it("preserves damaged configuration and imports prototype-like names as own data", async () => {
  const root = await fixture();
  const parsed = parseMcpImport('{"mcpServers":{"__proto__":{"command":"run"},"bad":{"url":"file:///x"}}}');
  expect(parsed.invalid).toEqual(["bad"]);
  await importMcpServers(parsed.servers, root);
  expect(Object.hasOwn(await listMcpServers(root), "__proto__")).toBe(true);
  const file = path.join(root, ".innocence/config.json");
  await fs.writeFile(file, '{"mcpServers":[]}', "utf8");
  await expect(saveMcpServer(root, "new", { command: "run" }, true)).rejects.toThrow();
  expect(await fs.readFile(file, "utf8")).toBe('{"mcpServers":[]}');
});
