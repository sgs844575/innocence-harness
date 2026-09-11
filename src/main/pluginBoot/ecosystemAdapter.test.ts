import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createEcosystemAdapterPlugin } from "./ecosystemAdapter";
import { scanUserPlugins, bundleProbe, nativeProbe } from "./userPluginScan";

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "ecoadapt-")); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

it("registers custom bundle component paths after discovery, even when the repository contains package metadata", async () => {
  const pluginRoot = join(dir, "installed-example");
  mkdirSync(join(pluginRoot, ".codex-plugin"), { recursive: true });
  mkdirSync(join(pluginRoot, "workflows", "review"), { recursive: true });
  writeFileSync(join(pluginRoot, ".codex-plugin", "plugin.json"), JSON.stringify({ name: "review-bundle", skills: "./workflows" }), "utf8");
  writeFileSync(join(pluginRoot, "package.json"), JSON.stringify({ name: "build-scripts" }), "utf8");
  writeFileSync(join(pluginRoot, "workflows", "review", "SKILL.md"), "---\nname: inspect-change\ndescription: Inspect a change\n---\nInspect the pending change.", "utf8");
  const scanned = await scanUserPlugins(dir, [bundleProbe, nativeProbe]);
  expect(scanned.descriptors[0]).toMatchObject({ id: "installed-example", format: "bundle" });
  const registered: Array<{ name: string; loadBody(): Promise<string> }> = [];
  await createEcosystemAdapterPlugin("installed-example", pluginRoot, () => {}).apply({ skills: { register: (skill: typeof registered[number]) => registered.push(skill) } } as never);
  expect(registered[0].name).toBe("inspect-change");
  expect(await registered[0].loadBody()).toBe("Inspect the pending change.");
});

function makeExternalPlugin() {
  mkdirSync(join(dir, ".claude-plugin"), { recursive: true });
  writeFileSync(join(dir, ".claude-plugin", "plugin.json"), '{"name":"cc-tool"}', "utf8");
  mkdirSync(join(dir, "commands"), { recursive: true });
  writeFileSync(join(dir, "commands", "hello.md"),
    "---\nname: hello\ndescription: Say hello\n---\nHello command body.", "utf8");
  writeFileSync(join(dir, "commands", "bare.md"), "No frontmatter command body."); // 降级路径
  mkdirSync(join(dir, "skills", "greet"), { recursive: true });
  writeFileSync(join(dir, "skills", "greet", "SKILL.md"),
    "---\nname: greet\ndescription: Greeting skill\n---\nGreet skill body.", "utf8");
  mkdirSync(join(dir, "agents"), { recursive: true });
  writeFileSync(join(dir, "agents", "bot.md"), "---\nname: bot\n---\npersona", "utf8");
  mkdirSync(join(dir, "hooks"), { recursive: true });
  writeFileSync(join(dir, "hooks", "x.json"), "{}", "utf8");
}

describe("createEcosystemAdapterPlugin", () => {
  it("maps commands and skills to harness skill registrations with bodies", async () => {
    makeExternalPlugin();
    const warnings: string[] = [];
    const registered: Array<{ name: string; description: string; loadBody: () => Promise<string> }> = [];
    const plugin = createEcosystemAdapterPlugin("cc-tool", dir, (level, channel, detail) => {
      warnings.push(`${level}:${channel}:${JSON.stringify(detail)}`);
    });
    await plugin.apply({ skills: { register: (s: never) => registered.push(s) } } as never);
    const names = registered.map((s) => s.name);
    expect(names).toContain("hello");
    expect(names).toContain("greet");
    const hello = registered.find((s) => s.name === "hello")!;
    expect(hello.description).toBe("Say hello");
    await expect(hello.loadBody()).resolves.toContain("Hello command body.");
    const bare = registered.find((s) => s.name === "bare");
    expect(bare).toBeDefined(); // 无 frontmatter 降级：name=文件名、description 首行/缺省
  });
  it("warns on hooks and leaves agent collection to session composition", async () => {
    makeExternalPlugin();
    const warnings: string[] = [];
    const registered: unknown[] = [];
    const plugin = createEcosystemAdapterPlugin("cc-tool", dir, (level, channel, detail) => {
      warnings.push(`${level}:${channel}:${JSON.stringify(detail)}`);
    });
    await plugin.apply({ skills: { register: (s: unknown) => registered.push(s) } } as never);
    expect(registered).toHaveLength(3); // hello + bare + greet
    expect(warnings.some((w) => w.includes("agents"))).toBe(false);
    expect(warnings.some((w) => w.includes("hooks"))).toBe(true);
  });
  it("degrades per-file failures to warnings without aborting the plugin", async () => {
    mkdirSync(join(dir, "commands"), { recursive: true });
    writeFileSync(join(dir, "commands", "good.md"), "---\nname: good\ndescription: d\n---\nbody", "utf8");
    writeFileSync(join(dir, "commands", "unreadable.md"), "---\nname: x\n", "utf8"); // 截断 frontmatter→解析 null→跳过告警
    const warnings: string[] = [];
    const registered: Array<{ name: string }> = [];
    const plugin = createEcosystemAdapterPlugin("cc-tool", dir, (level, channel, detail) => {
      warnings.push(`${level}:${channel}:${JSON.stringify(detail)}`);
    });
    await plugin.apply({ skills: { register: (s: { name: string }) => registered.push(s) } } as never);
    expect(registered.map((s) => s.name)).toEqual(["good"]);
    expect(warnings.some((w) => w.includes("unreadable"))).toBe(true);
  });
});
