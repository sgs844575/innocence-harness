// T2 resolveEntries 测试：拓扑语义平移（plugin-set 语义经 ConfigLayer 输入）、
// per-plugin config 传递、configSpecs 校验失败降级、disabled 条目产出。
import { describe, expect, it } from "vitest";
import { resolveEntries } from "./pluginEntries";
import type { ConfigLayer } from "./configSources";
import type { PluginDescriptor } from "../plugin-toggles-local";
import type { SchemaSpec } from "@innocenceharness/kernel-schema";

const DESCRIPTORS: readonly PluginDescriptor[] = [
  { id: "fs", dependencies: [], core: true },
  { id: "shell", dependencies: [], core: true },
  { id: "subagent", dependencies: ["fs", "shell"] },
  { id: "skills", dependencies: ["fs"] },
  { id: "mcp", dependencies: [] },
  { id: "todo", dependencies: [] },
];

function layer(
  toggles: Record<string, boolean>,
  configs: Record<string, unknown> = {},
  groups: ConfigLayer["groups"] = {},
): ConfigLayer {
  return { toggles, configs, groups };
}

describe("resolveEntries (topology passthrough)", () => {
  it("defaults to every descriptor as an active entry", () => {
    const resolved = resolveEntries(DESCRIPTORS);
    expect(resolved.active).toEqual(["fs", "shell", "subagent", "skills", "mcp", "todo"]);
    expect(resolved.entries.map((e) => ({ id: e.id, name: e.name, disabled: e.disabled ?? false })))
      .toEqual([
        { id: "fs", name: "fs", disabled: false },
        { id: "shell", name: "shell", disabled: false },
        { id: "subagent", name: "subagent", disabled: false },
        { id: "skills", name: "skills", disabled: false },
        { id: "mcp", name: "mcp", disabled: false },
        { id: "todo", name: "todo", disabled: false },
      ]);
    expect(resolved.skipped).toEqual([]);
    expect(resolved.warnings).toEqual([]);
  });

  it("project overrides user; core cannot be disabled (verbatim plugin-set semantics)", () => {
    const resolved = resolveEntries(
      DESCRIPTORS,
      layer({ mcp: false, subagent: false }),
      layer({ mcp: true }),
    );
    expect(resolved.active).toEqual(["fs", "shell", "skills", "mcp", "todo"]);
    expect(resolved.skipped).toEqual([
      { id: "subagent", reason: "disabled-by-config", via: "user" },
    ]);
  });

  it("disabled plugins still produce disabled entries (inventory-visible face)", () => {
    const resolved = resolveEntries(DESCRIPTORS, layer({ mcp: false, todo: false }));
    const byId = new Map(resolved.entries.map((e) => [e.id, e]));
    expect(byId.get("mcp")).toMatchObject({ name: "mcp", disabled: true });
    expect(byId.get("todo")).toMatchObject({ disabled: true });
    expect(byId.get("fs")).toMatchObject({ disabled: false });
    expect(resolved.active).not.toContain("mcp");
  });

  it("dependency closure skips dependents and marks their entries disabled", () => {
    const chain: readonly PluginDescriptor[] = [
      { id: "base", dependencies: [] },
      { id: "middle", dependencies: ["base"] },
      { id: "leaf", dependencies: ["middle"] },
    ];
    const resolved = resolveEntries(chain, layer({ base: false }));
    expect(resolved.active).toEqual([]);
    expect(resolved.skipped).toEqual([
      { id: "base", reason: "disabled-by-config", via: "user" },
      { id: "middle", reason: "dependency-disabled", via: "user" },
      { id: "leaf", reason: "dependency-disabled", via: "user" },
    ]);
    for (const e of resolved.entries) expect(e.disabled).toBe(true);
  });
});



describe("resolveEntries (groups)", () => {
  it("appends group loader rows after manifest entries", () => {
    const resolved = resolveEntries(
      DESCRIPTORS,
      layer({}, {}, {
        basic: {
          entries: [
            { id: "skills", name: "skills", config: { dirs: ["a"] } },
            { id: "mcp", name: "mcp", disabled: true },
          ],
        },
      }),
    );
    expect(resolved.entries.slice(-1)[0]).toEqual({
      id: "group:basic",
      name: "kernel:group",
      config: {
        id: "basic",
        entries: [
          { id: "skills", name: "skills", config: { dirs: ["a"] } },
          { id: "mcp", name: "mcp", disabled: true },
        ],
      },
    });
    expect(resolved.active.slice(-1)).toEqual(["group:basic"]);
  });

  it("uses project group atomically over user group", () => {
    const resolved = resolveEntries(
      DESCRIPTORS,
      layer({}, {}, { basic: { entries: [{ id: "user", name: "user" }] } }),
      layer({}, {}, { basic: { entries: [{ id: "project", name: "project" }] } }),
    );
    expect(resolved.entries.at(-1)?.config).toEqual({
      id: "basic",
      entries: [{ id: "project", name: "project" }],
    });
  });
});

describe("resolveEntries (config blocks)", () => {
  it("per-plugin config lands on the active entry", () => {
    const resolved = resolveEntries(
      DESCRIPTORS,
      undefined,
      layer({ }, { skills: { dirs: ["a"] }, mcp: { servers: { x: 1 } } }),
    );
    const byId = new Map(resolved.entries.map((e) => [e.id, e]));
    expect(byId.get("skills")?.config).toEqual({ dirs: ["a"] });
    expect(byId.get("mcp")?.config).toEqual({ servers: { x: 1 } });
    expect(byId.get("fs")?.config).toBeUndefined();
  });

  it("configs for disabled plugins are dropped from their entries", () => {
    const resolved = resolveEntries(
      DESCRIPTORS,
      layer({}, { mcp: { servers: 1 } }),
      layer({ mcp: false }),
    );
    expect(resolved.entries.find((e) => e.id === "mcp")?.disabled).toBe(true);
    expect(resolved.entries.find((e) => e.id === "mcp")?.config).toBeUndefined();
  });
});

describe("resolveEntries (configSpecs validation)", () => {
  const dirsSchema: SchemaSpec = {
    type: "object",
    properties: { dirs: { spec: { type: "array", items: { type: "string" } }, required: true } },
  };

  it("invalid config degrades the entry to skipped, not the whole resolve", () => {
    const resolved = resolveEntries(
      DESCRIPTORS,
      undefined,
      layer({}, { skills: { dirs: 42 } }),
      { skills: dirsSchema },
    );
    expect(resolved.active).not.toContain("skills");
    expect(resolved.skipped).toContainEqual({ id: "skills", reason: "config-invalid", via: "project" });
    expect(resolved.entries.find((e) => e.id === "skills")).toMatchObject({ disabled: true });
    expect(resolved.active).toContain("mcp");
    expect(resolved.warnings.join()).toContain("skills");
  });

  it("valid config passes through validated; missing spec means no validation", () => {
    const resolved = resolveEntries(
      DESCRIPTORS,
      undefined,
      layer({}, { skills: { dirs: ["a"], extra: 1 } }),
      { skills: dirsSchema },
    );
    expect(resolved.active).toContain("skills");
    expect(resolved.entries.find((e) => e.id === "skills")?.config)
      .toEqual({ dirs: ["a"], extra: 1 });
    // No configSpecs at all: any shape passes (v1 wiring point).
    const free = resolveEntries(DESCRIPTORS, undefined, layer({}, { skills: { nope: true } }));
    expect(free.active).toContain("skills");
  });

  it("config-invalid propagates to dependents as dependency-disabled", () => {
    const withDependent: readonly PluginDescriptor[] = [
      ...DESCRIPTORS,
      { id: "future", dependencies: ["skills"] },
    ];
    const resolved = resolveEntries(
      withDependent,
      undefined,
      layer({}, { skills: "not-an-object" }),
      { skills: dirsSchema },
    );
    expect(resolved.skipped).toContainEqual({ id: "skills", reason: "config-invalid", via: "project" });
    expect(resolved.skipped).toContainEqual({ id: "future", reason: "dependency-disabled", via: "project" });
  });
});
