// resolveEntries（T2 声明式装载面）：ConfigLayer 输入 → loader 形状的条目
// 集。拓扑语义（core 不可关/项目覆盖用户/依赖闭包/环）完全委托
// resolvePluginSet（逐字平移，不复制算法）；本模块只做三件事：
// 1. 条目投影——每个清单描述符产出一条 EntryOptions（active 条目携带归一
//    后的 per-plugin config；skipped 条目以 disabled:true 产出，清单/装载
//    面从 loader entries() 一致可见）；
// 2. configSpecs 校验——per-plugin config 块经标准协议校验器校验，失败将
//    该条目降级为 skipped（reason "config-invalid"）并告警，不炸整体；
//    降级发生在拓扑解析之前（坏 config 与显式禁用同等参与依赖闭包）；
// 3. 输出 active/skipped/warnings 与 resolvePluginSet 同形（config-invalid
//    的 via 为提供该 config 的层）。输入层不被修改。
import type { EntryOptions } from "@innocencecode/kernel-loader";
import { validateValue, type SchemaSpec } from "@innocencecode/kernel-schema";
import type {
  PluginDescriptor,
  PluginToggleSource,
  ResolvedPluginSet,
} from "../plugin-toggles-local";
import { resolvePluginSet } from "../plugin-toggles-local";
import type { ConfigLayer } from "./configSources";

/** config 校验失败降级的停用原因（补充枚举值，仅本声明式面产出）。 */
export type EntrySkipReason = "disabled-by-config" | "dependency-disabled" | "config-invalid";

export interface SkippedEntry {
  id: string;
  reason: EntrySkipReason;
  via: "user" | "project" | "default";
}

export interface ResolvedEntries {
  /** 拓扑序的 active id 列表（与 resolvePluginSet.active 同义同序）。 */
  active: string[];
  /** 每个清单描述符一条 loader 条目（active 携带 config；skipped 带 disabled）。 */
  entries: EntryOptions[];
  /** 停用条目（含 config-invalid 降级），依赖闭包语义与 resolvePluginSet 一致。 */
  skipped: SkippedEntry[];
  warnings: string[];
}

/** per-plugin config 校验规格（v1 无内置规格；T3/T4 按需接入）。 */
export type ConfigSpecs = Record<string, SchemaSpec>;

interface WorkingLayers {
  user: ConfigLayer;
  project: ConfigLayer | undefined;
}

/** 提供某插件 config 的层（project 键覆盖 user 键，同 toggles 语义）。 */
function configLayerOf(
  id: string,
  layers: WorkingLayers,
): { via: "user" | "project" | "default"; config: unknown } {
  if (layers.project && id in layers.project.configs) {
    return { via: "project", config: layers.project.configs[id] };
  }
  if (id in layers.user.configs) return { via: "user", config: layers.user.configs[id] };
  return { via: "default", config: undefined };
}

/**
 * 清单描述符 + 两级 ConfigLayer → 声明式条目集。configSpecs 缺省不校验
 * （任何 config 形状透传——schema 接线是后续任务）。skipped 条目仍产出
 * disabled:true 的条目：loader.startEntry 对 disabled 短路（不导入不挂载），
 * entries() 面可见，清单投影与装载面取同一数据源。输入层不被修改。
 */
export function resolveEntries(
  manifest: readonly PluginDescriptor[],
  user?: ConfigLayer,
  project?: ConfigLayer,
  configSpecs?: ConfigSpecs,
): ResolvedEntries {
  const warnings: string[] = [];
  const layers: WorkingLayers = {
    user: user
      ? {
          toggles: { ...user.toggles },
          configs: { ...user.configs },
          groups: user.groups ? { ...user.groups } : {},
        }
      : { toggles: {}, configs: {}, groups: {} },
    project: project
      ? {
          toggles: { ...project.toggles },
          configs: { ...project.configs },
          groups: project.groups ? { ...project.groups } : {},
        }
      : undefined,
  };
  const configInvalid = new Map<string, SkippedEntry>();

  // Pass 1: per-plugin config 校验（先于拓扑——坏 config 等价于显式禁用并
  // 参与依赖闭包；注入的 false 进入提供该 config 的层，via 如实记录）。
  if (configSpecs) {
    for (const descriptor of manifest) {
      const spec = configSpecs[descriptor.id];
      if (!spec) continue;
      const { via, config } = configLayerOf(descriptor.id, layers);
      if (config === undefined) continue;
      const result = validateValue(spec, config);
      if ("issues" in result) {
        warnings.push(
          `plugin "${descriptor.id}" config invalid (${via} layer): ` +
            result.issues
              .map((issue: { path: string; message: string }) =>
                issue.path === "" ? issue.message : `${issue.path}: ${issue.message}`)
              .join("; "),
        );
        configInvalid.set(descriptor.id, { id: descriptor.id, reason: "config-invalid", via });
        if (via === "project" && layers.project) {
          delete layers.project.configs[descriptor.id];
          layers.project.toggles[descriptor.id] = false;
        } else {
          delete layers.user.configs[descriptor.id];
          layers.user.toggles[descriptor.id] = false;
        }
      } else if (via === "project" && layers.project) {
        layers.project.configs[descriptor.id] = result.value;
      } else {
        layers.user.configs[descriptor.id] = result.value;
      }
    }
  }

  // Pass 2: 拓扑解析（resolvePluginSet 语义逐字保持——两级 toggles 原样
  // 传入，项目覆盖用户由其内部完成）。
  const resolved: ResolvedPluginSet = resolvePluginSet(
    manifest,
    layers.user.toggles as PluginToggleSource,
    layers.project?.toggles as PluginToggleSource | undefined,
  );
  warnings.push(...resolved.warnings);

  // config-invalid 条目在拓扑结果中要么经注入的 false 呈 disabled-by-config
  // （含 core 不可关拦截的告警——core 条目恒 active，降级标记被丢弃），
  // 要么被依赖连带停用——统一改判为 config-invalid（cause of record）。
  const skippedMap = new Map<string, SkippedEntry>(
    resolved.skipped.map((s) => {
      const override = configInvalid.get(s.id);
      return [s.id, override ? { ...s, reason: "config-invalid", via: override.via } : s];
    }),
  );

  // Pass 3: 条目投影（清单序）：active 携带校验后 config；skipped 出 disabled
  // 条目（disabled 恒显式，消费面无需 ?? false）。
  const entries: EntryOptions[] = manifest.map((descriptor): EntryOptions => {
    const skipped = skippedMap.has(descriptor.id);
    const row: EntryOptions = { id: descriptor.id, name: descriptor.id, disabled: skipped };
    if (!skipped) {
      const { config } = configLayerOf(descriptor.id, layers);
      if (config !== undefined) row.config = config;
    }
    return row;
  });

  // Groups are independent loader roots rather than manifest plugins. Project
  // declarations replace user declarations atomically, while preserving the
  // declaration order within each group and across groups.
  const groupNames = new Set([
    ...Object.keys(layers.user.groups ?? {}),
    ...Object.keys(layers.project?.groups ?? {}),
  ]);
  for (const name of groupNames) {
    const group = layers.project?.groups?.[name] ?? layers.user.groups?.[name];
    if (!group) continue;
    entries.push({
      id: `group:${name}`,
      name: "kernel:group",
      config: { id: name, entries: group.entries.map((entry) => ({ ...entry })) },
    });
  }

  const skippedList: SkippedEntry[] = manifest
    .filter((d) => skippedMap.has(d.id))
    .map((d) => skippedMap.get(d.id)!);
  return { active: [...resolved.active, ...[...groupNames].map((id) => id.startsWith("group:") ? id : `group:${id}`)], entries, skipped: skippedList, warnings };
}
