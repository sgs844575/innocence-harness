// 插件清单投影（IPC plugins:list 的载荷来源）：manifest 描述符元数据 +
// resolvePluginSet 的当前解析 → 设置页插件节的数据形状。纯函数、无 IO、
// 无 Electron——被 pluginBoot/compose 的 boot 面聚合（每次调用重跑解析，
// 状态随 toggles 即时反映）。shared/ipc.ts 是 DTO 的规范来源（渲染层
// 无法 import main），main 侧在此 re-export；镜像兼容由
// packages/harness-electron/tests/mirror.test.ts 守护。
import type {
  PluginInventoryEntry,
  PluginInventory,
  PluginInventoryState,
} from "../shared/ipc";
import type {
  PluginDescriptor,
  ResolvedPluginSet,
} from "./plugin-toggles-local";

export type { PluginInventoryEntry, PluginInventory } from "../shared/ipc";

/** projectPluginInventory 消费的最小解析形状（resolvePluginSet 与声明式
 *  resolveEntries 均结构满足；reason 允许声明式面的扩展枚举值）。 */
interface ResolvedShape {
  active: readonly string[];
  skipped: readonly { id: string; reason: string; via: PluginInventoryEntry["via"] }[];
}

/** manifest 描述符 + 解析结果 → 清单投影（跳过项带原因与获胜层，active
 *  项 via 恒 default；title 缺省回落 id——旧 manifest 兼容）。 */
export function projectPluginInventory(
  descriptors: readonly PluginDescriptor[],
  resolved: ResolvedShape | ResolvedPluginSet,
): PluginInventory {
  const skipped = new Map(resolved.skipped.map((entry) => [entry.id, entry]));
  return descriptors.map((descriptor) => {
    const skip = skipped.get(descriptor.id);
    return {
      id: descriptor.id,
      title: descriptor.title ?? descriptor.id,
      core: descriptor.core === true,
      client: descriptor.client === true,
      toggleable: descriptor.toggleable ?? descriptor.core !== true,
      state: (skip?.reason as PluginInventoryState | undefined) ?? "active",
      via: skip?.via ?? "default",
    };
  });
}
