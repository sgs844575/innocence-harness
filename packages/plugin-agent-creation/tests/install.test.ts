import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInstallUserPluginTool } from "../src/installUserPlugin";

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "userplugins-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const ctx = { signal: new AbortController().signal } as never;

describe("install_user_plugin", () => {
  it("writes package.json + dist/index.js under the user root", async () => {
    const tool = createInstallUserPluginTool({ userRoot: root });
    const res = await tool.execute(
      { id: "my-tool", packageJson: "{\"name\":\"my-tool\"}", indexJs: "export default { name: 'my-tool', apply() {} };" },
      ctx,
    );
    expect(res.isError).toBeFalsy();
    expect(existsSync(join(root, "my-tool", "dist", "index.js"))).toBe(true);
    expect(readFileSync(join(root, "my-tool", "package.json"), "utf8")).toContain("my-tool");
  });

  it("rejects path-escape ids", async () => {
    const tool = createInstallUserPluginTool({ userRoot: root });
    for (const id of ["../evil", "a/b", "..", "a\\b", " ", ""]) {
      const res = await tool.execute({ id, packageJson: "{}", indexJs: "" }, ctx);
      expect(res.isError).toBe(true);
    }
  });

  it("refuses overwrite without the explicit flag", async () => {
    mkdirSync(join(root, "exists"), { recursive: true });
    const tool = createInstallUserPluginTool({ userRoot: root });
    const res = await tool.execute({ id: "exists", packageJson: "{}", indexJs: "" }, ctx);
    expect(res.isError).toBe(true);
    const ok = await tool.execute({ id: "exists", packageJson: "{}", indexJs: "x", overwrite: true }, ctx);
    expect(ok.isError).toBeFalsy();
  });
});
