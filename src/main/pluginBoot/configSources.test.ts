// T2 声明式配置源测试：两格式归一（布尔/对象条目）、层合成（项目覆盖用户）、
// 损坏回落（读取面：缺文件静默、yaml 损坏告警回落 undefined）。纯函数面不
// 触盘；读取面用临时目录。
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  loadProjectConfigLayer,
  loadUserConfigLayer,
  mergeConfigLayers,
  parsePluginConfigLayer,
} from "./configSources";

const KNOWN = ["subagent", "skills", "mcp", "todo"] as const;

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "ic-cfgsrc-"));
  roots.push(dir);
  return dir;
}

describe("parsePluginConfigLayer (format normalization)", () => {
  it("boolean entries map to toggles only", () => {
    const parsed = parsePluginConfigLayer(
      { plugins: { mcp: false, skills: true } },
      { knownKeys: KNOWN },
    );
    expect(parsed.toggles).toEqual({ mcp: false, skills: true });
    expect(parsed.configs).toEqual({});
  });

  it("object entries contribute enabled + config blocks", () => {
    const parsed = parsePluginConfigLayer(
      {
        plugins: {
          skills: { enabled: true, config: { dirs: ["a"] } },
          mcp: { enabled: false },
        },
      },
      { knownKeys: KNOWN },
    );
    expect(parsed.toggles).toEqual({ skills: true, mcp: false });
    expect(parsed.configs).toEqual({ skills: { dirs: ["a"] } });
  });

  it("object entry without enabled defaults to enabled", () => {
    const parsed = parsePluginConfigLayer(
      { plugins: { todo: { config: { x: 1 } } } },
      { knownKeys: KNOWN },
    );
    expect(parsed.toggles).toEqual({ todo: true });
    expect(parsed.configs).toEqual({ todo: { x: 1 } });
  });

  it("non-boolean non-object values warn and are ignored", () => {
    const warnings: string[] = [];
    const parsed = parsePluginConfigLayer(
      { plugins: { skills: "nope" } },
      { knownKeys: KNOWN, where: "<f>", onWarning: (m) => warnings.push(m) },
    );
    expect(parsed.toggles).toEqual({});
    expect(warnings).toEqual(['plugin toggle "skills" in <f> must be a boolean; ignored']);
  });

  it("unknown keys are ignored with a warning (keyspace)", () => {
    const warnings: string[] = [];
    const parsed = parsePluginConfigLayer(
      { plugins: { mystery: true } },
      { knownKeys: KNOWN, where: "<f>", onWarning: (m) => warnings.push(m) },
    );
    expect(parsed.toggles).toEqual({});
    expect(warnings).toEqual(['unknown plugin toggle "mystery" in <f>; ignored']);
  });

  it("missing plugins block yields empty layer; missing input too", () => {
    const parsed = parsePluginConfigLayer({});
    expect(parsed.toggles).toEqual({});
    expect(parsePluginConfigLayer(undefined).toggles).toEqual({});
    expect(parsePluginConfigLayer(null).toggles).toEqual({});
    expect(parsePluginConfigLayer("plugins:").toggles).toEqual({});
  });
});

describe("mergeConfigLayers (project overrides user)", () => {
  it("merges toggles and configs independently, per key", () => {
    const merged = mergeConfigLayers(
      { toggles: { mcp: false, todo: true }, configs: { skills: { a: 1 }, mcp: { s: 1 } } },
      { toggles: { mcp: true }, configs: { skills: { b: 2 } } },
    );
    expect(merged.toggles).toEqual({ mcp: true, todo: true });
    expect(merged.configs).toEqual({ skills: { b: 2 }, mcp: { s: 1 } });
  });

  it("either side may be absent", () => {
    expect(mergeConfigLayers(undefined, { toggles: { mcp: false }, configs: {} })).toEqual({
      toggles: { mcp: false },
      configs: {},
    });
    expect(mergeConfigLayers({ toggles: {}, configs: {} }, undefined)).toEqual({
      toggles: {},
      configs: {},
    });
  });
});

describe("layer file readers", () => {
  it("user layer reads <home>/.innocence/cordis.yml; missing file is silently undefined", async () => {
    const home = tempDir();
    expect(await loadUserConfigLayer(home, () => {})).toBeUndefined();
    mkdirSync(path.join(home, ".innocence"), { recursive: true });
    writeFileSync(path.join(home, ".innocence", "cordis.yml"), "plugins:\n  mcp: false\n", "utf8");
    expect(await loadUserConfigLayer(home, () => {})).toEqual({
      toggles: { mcp: false },
      configs: {},
    });
  });

  it("project layer reads <root>/.innocence/plugins.yml including object entries", async () => {
    const root = tempDir();
    mkdirSync(path.join(root, ".innocence"), { recursive: true });
    writeFileSync(
      path.join(root, ".innocence", "plugins.yml"),
      "plugins:\n  skills:\n    enabled: false\n",
      "utf8",
    );
    expect(await loadProjectConfigLayer(root, () => {})).toEqual({
      toggles: { skills: false },
      configs: {},
    });
    expect(await loadProjectConfigLayer(tempDir(), () => {})).toBeUndefined();
  });

  it("corrupt yaml warns and falls back to undefined", async () => {
    const warnings: string[] = [];
    const home = tempDir();
    mkdirSync(path.join(home, ".innocence"), { recursive: true });
    writeFileSync(path.join(home, ".innocence", "cordis.yml"), "plugins: [unbalanced\n", "utf8");
    expect(await loadUserConfigLayer(home, (_level, msg) => warnings.push(msg))).toBeUndefined();
    expect(warnings).toHaveLength(1);

    const root = tempDir();
    mkdirSync(path.join(root, ".innocence"), { recursive: true });
    const file = path.join(root, ".innocence", "plugins.yml");
    writeFileSync(file, "plugins: [unbalanced\n", "utf8");
    expect(await loadProjectConfigLayer(root, (_level, msg) => warnings.push(msg))).toBeUndefined();
    expect(warnings).toHaveLength(2);
    expect(warnings[1]).toContain(file);
  });
});
