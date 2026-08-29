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

const GROUP_KNOWN = ["basic", "tools"] as const;

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
    const parsed = parsePluginConfigLayer({}, { knownKeys: KNOWN });
    expect(parsed.toggles).toEqual({});
    expect(parsePluginConfigLayer(undefined, { knownKeys: KNOWN }).toggles).toEqual({});
    expect(parsePluginConfigLayer(null, { knownKeys: KNOWN }).toggles).toEqual({});
    expect(parsePluginConfigLayer("plugins:", { knownKeys: KNOWN }).toggles).toEqual({});
  });

  it("键空间开放（清单注入）：清单内 id 直接通过、清单外键告警忽略", () => {
    const warnings: string[] = [];
    const parsed = parsePluginConfigLayer(
      { plugins: { example: false, mystery: true } },
      { knownKeys: [...KNOWN, "example"], where: "<f>", onWarning: (m) => warnings.push(m) },
    );
    expect(parsed.toggles).toEqual({ example: false });
    expect(warnings).toEqual(['unknown plugin toggle "mystery" in <f>; ignored']);
  });
});

describe("parsePluginConfigLayer (groups)", () => {
  it("parses ordered group children and preserves child config", () => {
    const warnings: string[] = [];
    const parsed = parsePluginConfigLayer(
      {
        groups: {
          basic: {
            entries: [
              { id: "skills", name: "skills", config: { dirs: ["a"] } },
              { id: "mcp", disabled: true },
            ],
          },
        },
      },
      { knownKeys: KNOWN, knownGroups: GROUP_KNOWN, onWarning: (m) => warnings.push(m) },
    );
    expect(parsed.groups).toEqual({
      basic: {
        entries: [
          { id: "skills", name: "skills", config: { dirs: ["a"] } },
          { id: "mcp", disabled: true },
        ],
      },
    });
    expect(warnings).toEqual([]);
  });

  it("warns and skips an empty child name", () => {
    const warnings: string[] = [];
    const parsed = parsePluginConfigLayer(
      { groups: { basic: { entries: [{ id: "todo", name: "" }] } } },
      { knownKeys: KNOWN, knownGroups: GROUP_KNOWN, where: "<f>", onWarning: (m) => warnings.push(m) },
    );
    expect(parsed.groups).toEqual({});
    expect(warnings).toEqual(['plugin group "basic" in <f> has invalid child entry; ignored']);
  });

  it("warns and ignores unknown or malformed groups", () => {
    const warnings: string[] = [];
    const parsed = parsePluginConfigLayer(
      { groups: { mystery: { entries: [] }, basic: { entries: [{ id: "" }] } } },
      { knownKeys: KNOWN, knownGroups: GROUP_KNOWN, where: "<f>", onWarning: (m) => warnings.push(m) },
    );
    expect(parsed.groups).toEqual({});
    expect(warnings).toEqual([
      'unknown plugin group "mystery" in <f>; ignored',
      'plugin group "basic" in <f> has invalid child entry; ignored',
    ]);
  });
  });


describe("mergeConfigLayers (project overrides user)", () => {
  it("merges toggles and configs independently, per key", () => {
    const merged = mergeConfigLayers(
      { toggles: { mcp: false, todo: true }, configs: { skills: { a: 1 }, mcp: { s: 1 } }, groups: { basic: { entries: [{ id: "one", name: "one" }] } } },
      { toggles: { mcp: true }, configs: { skills: { b: 2 } }, groups: { basic: { entries: [{ id: "two", name: "two" }] } } },
    );
    expect(merged.toggles).toEqual({ mcp: true, todo: true });
    expect(merged.configs).toEqual({ skills: { b: 2 }, mcp: { s: 1 } });
    expect(merged.groups).toEqual({ basic: { entries: [{ id: "two", name: "two" }] } });
  });

  it("either side may be absent", () => {
    expect(mergeConfigLayers(undefined, { toggles: { mcp: false }, configs: {}, groups: {} })).toEqual({
      toggles: { mcp: false },
      configs: {},
      groups: {},
    });
    expect(mergeConfigLayers({ toggles: {}, configs: {}, groups: {} }, undefined)).toEqual({
      toggles: {},
      configs: {},
      groups: {},
    });
  });

  it("hooks 声明按键原子覆盖：项目覆盖用户（不合并数组）", () => {
    const userHooks = [{ event: "sessionStart", command: "user-boot" }];
    const projectHooks = [{ event: "sessionStart", command: "project-boot" }];
    expect(
      mergeConfigLayers(
        { toggles: {}, configs: {}, groups: {}, hooks: userHooks },
        { toggles: {}, configs: {}, groups: {}, hooks: projectHooks },
      ).hooks,
    ).toEqual(projectHooks);
    // 单侧存在时另一侧回落：用户独有/项目独有分别胜出。
    expect(
      mergeConfigLayers({ toggles: {}, configs: {}, groups: {}, hooks: userHooks }, undefined).hooks,
    ).toEqual(userHooks);
    expect(
      mergeConfigLayers({ toggles: {}, configs: {}, groups: {} }, { toggles: {}, configs: {}, groups: {}, hooks: projectHooks }).hooks,
    ).toEqual(projectHooks);
  });
});

describe("parsePluginConfigLayer (top-level hooks declarations)", () => {
  it("passes the top-level hooks array through verbatim", () => {
    const declarations = [
      { event: "sessionStart", command: "boot-hook" },
      { event: "preToolCall", command: "guard-hook", match: "Write", timeoutMs: 5000 },
    ];
    const parsed = parsePluginConfigLayer(
      { hooks: declarations },
      { knownKeys: KNOWN },
    );
    expect(parsed.hooks).toEqual(declarations);
    expect(parsed.toggles).toEqual({});
    expect(parsed.configs).toEqual({});
  });

  it("keeps hooks absent when the key is missing; non-array shapes still pass through", () => {
    expect(parsePluginConfigLayer({}, { knownKeys: KNOWN }).hooks).toBeUndefined();
    expect(parsePluginConfigLayer({ plugins: { mcp: false } }, { knownKeys: KNOWN }).hooks).toBeUndefined();
    // 形状校验归插件侧解析面（坏形状在会话启动块告警），此处透传不告警。
    const warnings: string[] = [];
    const parsed = parsePluginConfigLayer(
      { hooks: "not-an-array" },
      { knownKeys: KNOWN, where: "<f>", onWarning: (m) => warnings.push(m) },
    );
    expect(parsed.hooks).toBe("not-an-array");
    expect(warnings).toEqual([]);
  });

  it("hooks 键与 plugins.hooks 开关是两个面：对象条目仍走 toggles/configs", () => {
    // 顶层 hooks: 声明数组（执行面配置）；plugins.hooks 是插件开关（清单 id）。
    const parsed = parsePluginConfigLayer(
      { hooks: [{ event: "sessionStart", command: "boot" }], plugins: { hooks: { enabled: false, config: { x: 1 } } } },
      { knownKeys: [...KNOWN, "hooks"] },
    );
    expect(parsed.hooks).toEqual([{ event: "sessionStart", command: "boot" }]);
    expect(parsed.toggles).toEqual({ hooks: false });
    expect(parsed.configs).toEqual({ hooks: { x: 1 } });
  });
});

describe("layer file readers", () => {
  it("user layer reads <home>/.innocence/cordis.yml; missing file is silently undefined", async () => {
    const home = tempDir();
    expect(await loadUserConfigLayer(home, () => {}, KNOWN)).toBeUndefined();
    mkdirSync(path.join(home, ".innocence"), { recursive: true });
    writeFileSync(path.join(home, ".innocence", "cordis.yml"), "plugins:\n  mcp: false\n", "utf8");
    expect(await loadUserConfigLayer(home, () => {}, KNOWN)).toEqual({
      toggles: { mcp: false },
      configs: {},
      groups: {},
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
    expect(await loadProjectConfigLayer(root, () => {}, KNOWN)).toEqual({
      toggles: { skills: false },
      configs: {},
      groups: {},
    });
    expect(await loadProjectConfigLayer(tempDir(), () => {}, KNOWN)).toBeUndefined();
  });

  it("corrupt yaml warns and falls back to undefined", async () => {
    const warnings: string[] = [];
    const home = tempDir();
    mkdirSync(path.join(home, ".innocence"), { recursive: true });
    writeFileSync(path.join(home, ".innocence", "cordis.yml"), "plugins: [unbalanced\n", "utf8");
    expect(await loadUserConfigLayer(home, (_level, msg) => warnings.push(msg), KNOWN)).toBeUndefined();
    expect(warnings).toHaveLength(1);

    const root = tempDir();
    mkdirSync(path.join(root, ".innocence"), { recursive: true });
    const file = path.join(root, ".innocence", "plugins.yml");
    writeFileSync(file, "plugins: [unbalanced\n", "utf8");
    expect(await loadProjectConfigLayer(root, (_level, msg) => warnings.push(msg), KNOWN)).toBeUndefined();
    expect(warnings).toHaveLength(2);
    expect(warnings[1]).toContain(file);
  });

  it("both carriers read the top-level hooks declarations", async () => {
    const home = tempDir();
    mkdirSync(path.join(home, ".innocence"), { recursive: true });
    writeFileSync(
      path.join(home, ".innocence", "cordis.yml"),
      "hooks:\n  - event: sessionStart\n    command: user-boot\n",
      "utf8",
    );
    const userLayer = await loadUserConfigLayer(home, () => {}, KNOWN);
    expect(userLayer?.hooks).toEqual([{ event: "sessionStart", command: "user-boot" }]);

    const root = tempDir();
    mkdirSync(path.join(root, ".innocence"), { recursive: true });
    writeFileSync(
      path.join(root, ".innocence", "plugins.yml"),
      "hooks:\n  - event: preToolCall\n    command: project-guard\n",
      "utf8",
    );
    const projectLayer = await loadProjectConfigLayer(root, () => {}, KNOWN);
    expect(projectLayer?.hooks).toEqual([{ event: "preToolCall", command: "project-guard" }]);
  });
});
