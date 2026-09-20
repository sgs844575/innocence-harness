import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import { readHooksFile, writeHooksFile } from "./hookSettingsStore";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((r) => fs.rm(r, { recursive: true, force: true }))); });
async function fixture(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "innocence-hook-store-"));
  roots.push(root);
  return path.join(root, ".innocence", "plugins.yml");
}

describe("hook settings store", () => {
  it("reads missing files as empty and round-trips a hooks array", async () => {
    const file = await fixture();
    expect(await readHooksFile(file)).toEqual([]);
    await writeHooksFile(file, [{ event: "sessionStart", command: "node boot.js" }]);
    expect(await readHooksFile(file)).toEqual([{ event: "sessionStart", command: "node boot.js" }]);
  });

  it("preserves other top-level keys and unknown fields on entries", async () => {
    const file = await fixture();
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, "plugins:\n  mcp: false\ngroups:\n  g:\n    entries: []\nhooks:\n  - event: turnEnd\n    command: a b\n    custom: keep-me\n", "utf8");
    const hooks = await readHooksFile(file);
    expect(hooks).toEqual([{ event: "turnEnd", command: "a b", custom: "keep-me" }]);
    hooks.push({ event: "sessionStop", command: "bye" });
    await writeHooksFile(file, hooks);
    const doc = parseYaml(await fs.readFile(file, "utf8"));
    expect(doc.plugins).toEqual({ mcp: false });
    expect(doc.groups).toEqual({ g: { entries: [] } });
    expect(doc.hooks).toEqual([{ event: "turnEnd", command: "a b", custom: "keep-me" }, { event: "sessionStop", command: "bye" }]);
  });

  it("removes the hooks key when the array becomes empty", async () => {
    const file = await fixture();
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, "plugins:\n  mcp: false\nhooks:\n  - event: turnEnd\n    command: x\n", "utf8");
    await writeHooksFile(file, []);
    const doc = parseYaml(await fs.readFile(file, "utf8"));
    expect(doc).toEqual({ plugins: { mcp: false } });
  });

  it("refuses corrupt or non-mapping files instead of destroying them", async () => {
    const file = await fixture();
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, "plugins: [unbalanced\n", "utf8");
    await expect(readHooksFile(file)).rejects.toThrow("not parseable");
    await expect(writeHooksFile(file, [])).rejects.toThrow("not parseable");
    expect(await fs.readFile(file, "utf8")).toBe("plugins: [unbalanced\n");
    await fs.writeFile(file, "- just\n- a\n- list\n", "utf8");
    await expect(readHooksFile(file)).rejects.toThrow("must be a mapping");
    await fs.writeFile(file, "hooks: not-an-array\n", "utf8");
    await expect(readHooksFile(file)).rejects.toThrow("must be an array");
  });
});
