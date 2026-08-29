// 声明式配置源（T2）：两级配置的读取与归一——用户级 ~/.innocence/cordis.yml
// （新文件，可不存在）与项目级 <root>/.innocence/plugins.yml（在原布尔开关
// 语义上扩展对象条目）。两种条目格式在此归一为 ConfigLayer（toggles +
// configs + groups + 顶层 hooks 声明透传）；层合成（项目覆盖用户，按键
// `projectValue ?? userValue`；hooks 同键原子覆盖）与 resolvePluginSet 的
// 语义逐字对齐。纯函数面（parse/merge）零 IO；读取面损坏回落 undefined
// 并经 logger 告警，不炸调用方。
import fs from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml } from "yaml";

export type ConfigLogger = (level: "warn" | "error", msg: string, data?: unknown) => void;

/** A normalized child row declared inside one loader group. */
export interface GroupEntryConfig {
  id: string;
  name?: string;
  config?: unknown;
  disabled?: boolean;
}

/** A normalized, ordered loader group declaration. */
export interface GroupConfig {
  entries: GroupEntryConfig[];
}

/** 归一后的一个配置层：布尔开关面 + per-plugin 配置块 + groups。 */
export interface ConfigLayer {
  /** 布尔开关（旧式布尔条目 + 新式条目的 enabled）。 */
  toggles: Record<string, boolean>;
  /** per-plugin 配置块（新式条目的 config）。 */
  configs: Record<string, unknown>;
  /** Declarative loader groups keyed by their stable group name. */
  groups: Record<string, GroupConfig>;
  /**
   * 顶层 `hooks:` 声明（批次 4C 钩子面）：原样透传——形状校验归
   * plugin-hooks 的解析面（坏形状在会话启动块告警降级，不在此重复）。
   * 与 `plugins.hooks` 开关（清单 id 的启停面）是两个不同的键。
   */
  hooks?: unknown;
}

const emptyLayer: () => ConfigLayer = () => ({ toggles: {}, configs: {}, groups: {} });

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validSegment(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.trim() === value && !/[\\/:]/.test(value);
}

function parseGroups(
  raw: unknown,
  layer: ConfigLayer,
  options: { knownGroups?: readonly string[]; where: string; onWarning?: (msg: string) => void },
): void {
  if (raw === undefined) return;
  if (!isRecord(raw)) {
    options.onWarning?.(`"groups" in ${options.where} must be a mapping; ignored`);
    return;
  }
  for (const [groupId, value] of Object.entries(raw)) {
    if (!validSegment(groupId) || !isRecord(value) || !Array.isArray(value.entries)) {
      options.onWarning?.(`plugin group "${groupId}" in ${options.where} must declare a valid group name and entries array; ignored`);
      continue;
    }
    if (options.knownGroups && !options.knownGroups.includes(groupId)) {
      options.onWarning?.(`unknown plugin group "${groupId}" in ${options.where}; ignored`);
      continue;
    }
    if (!options.knownGroups) {
      // Group names are user-defined in cordis.yml; when no host registry is
      // supplied, keep the declaration and emit an observable informational
      // warning rather than inventing a fixed allow-list.
      options.onWarning?.(`plugin group "${groupId}" in ${options.where} has no registered descriptor; accepting declaration`);
    }
    const entries: GroupEntryConfig[] = [];
    let valid = true;
    for (const child of value.entries) {
      if (!isRecord(child) || !validSegment(child.id) ||
        (child.name !== undefined && (typeof child.name !== "string" || child.name.trim().length === 0)) ||
        (child.disabled !== undefined && typeof child.disabled !== "boolean")) {
        options.onWarning?.(`plugin group "${groupId}" in ${options.where} has invalid child entry; ignored`);
        valid = false;
        break;
      }
      entries.push({
        id: child.id,
        ...(child.name !== undefined ? { name: child.name } : {}),
        ...(child.config !== undefined ? { config: child.config } : {}),
        ...(child.disabled !== undefined ? { disabled: child.disabled } : {}),
      });
    }
    if (valid) layer.groups[groupId] = { entries };
  }
}

/**
 * 一个配置文件的 plugins 块 → ConfigLayer。两种条目格式：
 * 布尔（`mcp: false`，旧式）→ toggles；对象（`skills: {enabled, config}`，
 * 新式）→ enabled 进 toggles（缺省 true）+ config 进 configs。groups 是同一
 * 文档的独立顶层声明面，由 knownGroups（若提供）限制键空间。
 */
export function parsePluginConfigLayer(
  raw: unknown,
  options: {
    knownKeys: readonly string[];
    knownGroups?: readonly string[];
    where?: string;
    onWarning?: (msg: string) => void;
  },
): ConfigLayer {
  const known = options.knownKeys;
  const where = options.where ?? "config";
  const layer = emptyLayer();
  if (!isRecord(raw)) return layer;
  const plugins = raw.plugins;
  if (plugins !== undefined) {
    if (!isRecord(plugins)) {
      options.onWarning?.(`"plugins" in ${where} must be a mapping; ignored`);
    } else {
      for (const [key, value] of Object.entries(plugins)) {
        if (!known.includes(key)) {
          options.onWarning?.(`unknown plugin toggle "${key}" in ${where}; ignored`);
          continue;
        }
        if (typeof value === "boolean") {
          layer.toggles[key] = value;
          continue;
        }
        if (isRecord(value)) {
          const entry = value as { enabled?: unknown; config?: unknown };
          if (entry.enabled !== undefined && typeof entry.enabled !== "boolean") {
            options.onWarning?.(`plugin toggle "${key}" in ${where} must be a boolean; ignored`);
            continue;
          }
          layer.toggles[key] = entry.enabled ?? true;
          if (entry.config !== undefined) layer.configs[key] = entry.config;
          continue;
        }
        options.onWarning?.(`plugin toggle "${key}" in ${where} must be a boolean; ignored`);
      }
    }
  }
  parseGroups(raw.groups, layer, { knownGroups: options.knownGroups, where, onWarning: options.onWarning });
  // 顶层 hooks: 声明透传（缺省不设键）。与 plugins.hooks 开关互不相干：
  // 前者是钩子执行面配置（数组），后者是清单 id 的启停开关。
  if (raw.hooks !== undefined) layer.hooks = raw.hooks;
  return layer;
}

/** 层合成：项目覆盖用户；groups 按组名原子覆盖，避免半合并有序子项；
 *  顶层 hooks 声明同键原子覆盖（项目值整体替换用户值，不合并数组）。 */
export function mergeConfigLayers(
  user: ConfigLayer | undefined,
  project: ConfigLayer | undefined,
): ConfigLayer {
  const merged = emptyLayer();
  for (const source of [user, project]) {
    if (!source) continue;
    for (const [key, value] of Object.entries(source.toggles)) merged.toggles[key] = value;
    for (const [key, value] of Object.entries(source.configs)) merged.configs[key] = value;
    for (const [key, value] of Object.entries(source.groups ?? {})) {
      merged.groups![key] = { entries: value.entries.map((entry) => ({ ...entry })) };
    }
    if (source.hooks !== undefined) merged.hooks = source.hooks;
  }
  return merged;
}

/** 读一个 yaml 配置文件并归一；缺文件静默 undefined，损坏回落 undefined。
 *  knownKeys（键空间）必填——清单 id 集由调用方注入。 */
async function readLayer(
  file: string,
  label: string,
  log: ConfigLogger,
  knownKeys: readonly string[],
  knownGroups?: readonly string[],
): Promise<ConfigLayer | undefined> {
  let raw: string;
  try {
    raw = await fs.readFile(file, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    log("warn", `failed to read ${file}; ignoring ${label} plugin config`, err);
    return undefined;
  }
  let doc: unknown;
  try {
    doc = parseYaml(raw);
  } catch (err) {
    log("warn", `failed to parse ${file} as yaml; ignoring ${label} plugin config`, err);
    return undefined;
  }
  if (doc !== undefined && (typeof doc !== "object" || doc === null || Array.isArray(doc))) {
    log("warn", `${file} must be a yaml mapping; ignoring ${label} plugin config`);
    return undefined;
  }
  // 归一面复用（含对象条目扩展）；顶层损坏归空层（与旧读取面的回落语义一致：
  // 坏文件不产生任何效果，只告警）。
  if (doc === undefined) {
    log("warn", `${file} must be a yaml mapping; ignoring ${label} plugin config`);
    return undefined;
  }
  const layer = parsePluginConfigLayer(doc, {
    knownKeys,
    knownGroups,
    where: file,
    onWarning: (msg) => log("warn", msg),
  });
  // 空文件/无 plugins 块也产出层（区别于读不到文件）：内容恒等价于空层，
  // 调用方按"文件存在"合并。为读取面最小语义，这里统一返回归一层。
  return layer;
}

/** 用户级配置：`<home>/.innocence/cordis.yml`（home 通常为 os.homedir()）。
 *  knownKeys 为清单 id 集（键空间清单派生）。 */
export async function loadUserConfigLayer(
  home: string,
  log: ConfigLogger,
  knownKeys: readonly string[],
  knownGroups?: readonly string[],
): Promise<ConfigLayer | undefined> {
  return readLayer(path.join(home, ".innocence", "cordis.yml"), "user", log, knownKeys, knownGroups);
}

/** 项目级配置：`<root>/.innocence/plugins.yml`（布尔语义的声明式扩展）。
 *  knownKeys 为清单 id 集（键空间清单派生）。 */
export async function loadProjectConfigLayer(
  root: string,
  log: ConfigLogger,
  knownKeys: readonly string[],
  knownGroups?: readonly string[],
): Promise<ConfigLayer | undefined> {
  return readLayer(path.join(root, ".innocence", "plugins.yml"), "project", log, knownKeys, knownGroups);
}

/** 一次性读齐两级配置层（用户 cordis.yml + 项目 plugins.yml）并合成用户层：
 *  cordis.yml 提供基础开关与 config 块，settings 开关（UI 管理面）按键覆盖；
 *  项目层独立返回（项目覆盖用户由 resolveEntries/resolvePluginSet 完成）。
 *  缺文件/损坏均回落（undefined 分量），不炸调用方。knownKeys 为清单
 *  id 集（键空间清单派生，双级共用）。 */
export async function loadConfigLayerPair(
  home: string,
  workspaceRoot: string | undefined,
  settingsToggles: Record<string, boolean> | undefined,
  log: ConfigLogger,
  knownKeys: readonly string[],
  knownGroups?: readonly string[],
): Promise<{ user: ConfigLayer; project: ConfigLayer | undefined }> {
  const [userFile, projectLayer] = await Promise.all([
    loadUserConfigLayer(home, log, knownKeys, knownGroups),
    workspaceRoot ? loadProjectConfigLayer(workspaceRoot, log, knownKeys, knownGroups) : Promise.resolve(undefined),
  ]);
  return {
    user: {
      toggles: { ...(userFile?.toggles ?? {}), ...(settingsToggles ?? {}) },
      configs: userFile?.configs ?? {},
      groups: userFile?.groups ?? {},
      // 顶层 hooks 声明随用户文件层透传（settings 开关面不覆盖声明面）。
      hooks: userFile?.hooks,
    },
    project: projectLayer,
  };
}
