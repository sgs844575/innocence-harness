// 本地 plugin-set 拷贝的钉死测试（T11 自已删除的 core 包迁入 src/main；原件
// T12 删除）：不依赖 staging，干净检出恒可跑——覆盖两级覆盖/依赖连带/core
// 恒开。文件读取面（loadPluginToggles）已在阶段 2 任务 3 删除（项目层由
// pluginBoot/configSources 读取，开放键空间），其告警文案断言随之迁移
// （configSources.test 逐字覆盖同一文案族）。
import { describe, expect, it } from "vitest";
import { resolvePluginSet, type PluginDescriptor } from "./plugin-toggles-local";

const DESCRIPTORS: readonly PluginDescriptor[] = [
  { id: "fs", dependencies: [], core: true },
  { id: "shell", dependencies: [], core: true },
  { id: "subagent", dependencies: ["fs", "shell"] },
  { id: "skills", dependencies: ["fs"] },
  { id: "mcp", dependencies: [] },
  { id: "todo", dependencies: [] },
];

describe("resolvePluginSet (local copy)", () => {
  it("defaults to everything active", () => {
    const resolved = resolvePluginSet(DESCRIPTORS);
    expect(resolved.active).toEqual(["fs", "shell", "subagent", "skills", "mcp", "todo"]);
    expect(resolved.skipped).toEqual([]);
    expect(resolved.warnings).toEqual([]);
  });

  it("project overrides user; core cannot be disabled", () => {
    const resolved = resolvePluginSet(
      DESCRIPTORS,
      { mcp: false, subagent: false },
      // shell 在 PluginToggleSource 的类型面之外（核心件无开关），这里以
      // 字面量直入驱动“core 不可关”告警路径（算法按键动态读取）。
      { mcp: true, shell: false } as never,
    );
    // mcp re-enabled by the project layer; shell (core) ignores the toggle.
    expect(resolved.active).toEqual(["fs", "shell", "skills", "mcp", "todo"]);
    expect(resolved.skipped).toEqual([
      { id: "subagent", reason: "disabled-by-config", via: "user" },
    ]);
    expect(resolved.warnings).toEqual([
      "plugin \"shell\" is core and cannot be disabled; ignoring project toggle",
    ]);
  });

  it("disabling a dependency transitively skips dependents", () => {
    // The builtin descriptor set has only core dependencies, so the
    // dependency-closure is pinned on a synthetic set (same algorithm).
    const synthetic: readonly PluginDescriptor[] = [
      { id: "base", dependencies: [] },
      { id: "middle", dependencies: ["base"] },
      { id: "leaf", dependencies: ["middle"] },
    ];
    const resolved = resolvePluginSet(synthetic, { base: false } as never);
    expect(resolved.active).toEqual([]);
    expect(resolved.skipped).toEqual([
      { id: "base", reason: "disabled-by-config", via: "user" },
      { id: "middle", reason: "dependency-disabled", via: "user" },
      { id: "leaf", reason: "dependency-disabled", via: "user" },
    ]);
  });

  it("warns on unknown toggle keys in both layers", () => {
    const resolved = resolvePluginSet(
      DESCRIPTORS,
      { nope: false } as never,
      { other: true } as never,
    );
    expect(resolved.warnings).toEqual([
      'unknown plugin toggle "nope" in user toggles; ignored',
      'unknown plugin toggle "other" in project toggles; ignored',
    ]);
    expect(resolved.active).toHaveLength(DESCRIPTORS.length);
  });

  it("开放键空间：清单内 id（含 example 等新增插件键）直接生效", () => {
    const withExample: readonly PluginDescriptor[] = [
      ...DESCRIPTORS,
      { id: "example", dependencies: [] },
    ];
    const resolved = resolvePluginSet(withExample, { example: false });
    expect(resolved.active).not.toContain("example");
    expect(resolved.skipped).toEqual([
      { id: "example", reason: "disabled-by-config", via: "user" },
    ]);
    expect(resolved.warnings).toEqual([]);
  });
});
