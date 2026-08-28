import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scanUserPlugins } from "./userPluginScan";

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), "scanroot-")); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

function plugin(id: string, pkg: Record<string, unknown>) {
  mkdirSync(join(root, id, "dist"), { recursive: true });
  writeFileSync(join(root, id, "package.json"), JSON.stringify(pkg), "utf8");
  writeFileSync(join(root, id, "dist", "index.js"), "export default {};", "utf8");
}

describe("scanUserPlugins", () => {
  it("discovers native-format plugins with title and agent-mode kind metadata", async () => {
    plugin("my-tool", { name: "my-tool", description: "My custom tool" });
    plugin("my-mode", { name: "my-mode", innocenceharness: { agentMode: { title: "My Mode" } } });
    const { descriptors, warnings } = await scanUserPlugins(root);
    const tool = descriptors.find((d) => d.id === "my-tool");
    expect(tool?.title).toBe("My custom tool");
    expect(tool?.toggleable).toBe(true);
    const mode = descriptors.find((d) => d.id === "my-mode");
    expect(mode?.kind).toBe("agent-mode");
    expect(mode?.title).toBe("My Mode");
    expect(warnings).toEqual([]);
  });
  it("skips and warns on broken directories and unsafe ids", async () => {
    mkdirSync(join(root, "..evil"), { recursive: true }); // 非法段名
    mkdirSync(join(root, "empty-pkg"), { recursive: true }); // 无 package.json
    const { descriptors, warnings } = await scanUserPlugins(root);
    expect(descriptors).toEqual([]);
    expect(warnings.length).toBeGreaterThanOrEqual(2);
  });
});
