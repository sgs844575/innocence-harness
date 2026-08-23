// 清单投影纯函数的钉死测试：manifest 描述符（title/core/client）+
// resolvePluginSet 结果 → PluginsSection 消费的条目形状。不依赖 staging，
// 干净检出恒可跑。
import { describe, expect, it } from "vitest";
import { projectPluginInventory, type PluginInventoryEntry } from "./plugin-inventory";
import { resolvePluginSet, type PluginDescriptor } from "./plugin-toggles-local";

describe("projectPluginInventory (manifest + resolved set 投影)", () => {
  // 清单描述符（含 build:plugins 产出的 title/client 投影字段）。
  const RICH: readonly PluginDescriptor[] = [
    { id: "fs", dependencies: [], core: true, title: "文件系统工具", client: false },
    { id: "skills", dependencies: ["fs"], title: "技能加载器", client: true },
    { id: "mcp", dependencies: [], title: "外部工具服务器客户端" },
  ];

  it("默认全 active/via default，按描述符序合并 title/core/client/toggleable", () => {
    const entries = projectPluginInventory(RICH, resolvePluginSet(RICH));
    expect(entries).toEqual<PluginInventoryEntry[]>([
      { id: "fs", title: "文件系统工具", core: true, client: false, toggleable: false, state: "active", via: "default" },
      { id: "skills", title: "技能加载器", core: false, client: true, toggleable: true, state: "active", via: "default" },
      { id: "mcp", title: "外部工具服务器客户端", core: false, client: false, toggleable: true, state: "active", via: "default" },
    ]);
  });

  it("跳过项带原因与获胜层；依赖连带继承来源层", () => {
    const synthetic: readonly PluginDescriptor[] = [
      { id: "base", dependencies: [], title: "基座" },
      { id: "middle", dependencies: ["base"], title: "中层" },
      { id: "free", dependencies: [], title: "独立" },
    ];
    const resolved = resolvePluginSet(synthetic, { base: false });
    const entries = projectPluginInventory(synthetic, resolved);
    expect(entries).toEqual<PluginInventoryEntry[]>([
      { id: "base", title: "基座", core: false, client: false, toggleable: true, state: "disabled-by-config", via: "user" },
      { id: "middle", title: "中层", core: false, client: false, toggleable: true, state: "dependency-disabled", via: "user" },
      { id: "free", title: "独立", core: false, client: false, toggleable: true, state: "active", via: "default" },
    ]);
  });

  it("描述符缺 title 时回落 id（旧 manifest 兼容）；缺 toggleable 回落 !core", () => {
    const plain: readonly PluginDescriptor[] = [
      { id: "todo", dependencies: [] },
      { id: "fs", dependencies: [], core: true },
    ];
    const entries = projectPluginInventory(plain, resolvePluginSet(plain));
    expect(entries[0]).toMatchObject({ title: "todo", toggleable: true });
    expect(entries[1]).toMatchObject({ core: true, toggleable: false });
  });

  it("config-invalid 降级原因受控投影（声明式面 reason 扩展枚举）", () => {
    const descriptors: readonly PluginDescriptor[] = [{ id: "skills", dependencies: [], title: "技能" }];
    const entries = projectPluginInventory(descriptors, {
      active: [],
      skipped: [{ id: "skills", reason: "config-invalid", via: "user" }],
    });
    expect(entries).toEqual<PluginInventoryEntry[]>([
      { id: "skills", title: "技能", core: false, client: false, toggleable: true, state: "config-invalid", via: "user" },
    ]);
  });
});
