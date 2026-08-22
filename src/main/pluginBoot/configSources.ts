// 声明式配置源（T2）：两级配置的读取与归一——用户级 ~/.innocence/cordis.yml
// （新文件，可不存在）与项目级 <root>/.innocence/plugins.yml（在原布尔开关
// 语义上扩展对象条目）。两种条目格式在此归一为 ConfigLayer（toggles +
// configs）；层合成（项目覆盖用户，按键 `projectValue ?? userValue`）与
// resolvePluginSet 的语义逐字对齐。纯函数面（parse/merge）零 IO；读取面
// 损坏回落 undefined 并经 logger 告警，不炸调用方。
import fs from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml } from "yaml";

export type ConfigLogger = (level: "warn" | "error", msg: string, data?: unknown) => void;

/** 归一后的一个配置层：布尔开关面 + per-plugin 配置块。 */
export interface ConfigLayer {
  /** 布尔开关（旧式布尔条目 + 新式条目的 enabled）。 */
  toggles: Record<string, boolean>;
  /** per-plugin 配置块（新式条目的 config）。 */
  configs: Record<string, unknown>;
}

const emptyLayer: () => ConfigLayer = () => ({ toggles: {}, configs: {} });

/** 插件开关键空间（四键，与设置面/清单投影共用语义）。 */
export const KNOWN_PLUGIN_KEYS: readonly string[] = ["subagent", "skills", "mcp", "todo"];

/**
 * 一个配置文件的 plugins 块 → ConfigLayer。两种条目格式：
 * 布尔（`mcp: false`，旧式）→ toggles；对象（`skills: {enabled, config}`，
 * 新式）→ enabled 进 toggles（缺省 true）+ config 进 configs。布尔语义与
 * 原 loadPluginToggles 逐字一致（未知键/非布尔值告警忽略）。`raw` 为已解析
 * 的 yaml 文档（顶层 mapping）；undefined/空文档产出空层。
 */
export function parsePluginConfigLayer(
  raw: unknown,
  options: { knownKeys?: readonly string[]; where?: string; onWarning?: (msg: string) => void } = {},
): ConfigLayer {
  const known = options.knownKeys ?? KNOWN_PLUGIN_KEYS;
  const where = options.where ?? "config";
  const layer = emptyLayer();
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return layer;
  const plugins = (raw as Record<string, unknown>).plugins;
  if (plugins === undefined) return layer;
  if (typeof plugins !== "object" || plugins === null || Array.isArray(plugins)) {
    options.onWarning?.(`"plugins" in ${where} must be a mapping; ignored`);
    return layer;
  }
  for (const [key, value] of Object.entries(plugins as Record<string, unknown>)) {
    if (!known.includes(key)) {
      options.onWarning?.(`unknown plugin toggle "${key}" in ${where}; ignored`);
      continue;
    }
    if (typeof value === "boolean") {
      layer.toggles[key] = value;
      continue;
    }
    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
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
  return layer;
}

/**
 * 层合成：项目覆盖用户。toggles 与 configs 分别按 key 覆盖（同
 * resolvePluginSet 的 `projectValue ?? userValue` 语义——显式键覆盖，
 * 缺席键透传另一层）。
 */
export function mergeConfigLayers(
  user: ConfigLayer | undefined,
  project: ConfigLayer | undefined,
): ConfigLayer {
  const merged = emptyLayer();
  for (const source of [user, project]) {
    if (!source) continue;
    for (const [key, value] of Object.entries(source.toggles)) merged.toggles[key] = value;
    for (const [key, value] of Object.entries(source.configs)) merged.configs[key] = value;
  }
  return merged;
}

/** 读一个 yaml 配置文件并归一；缺文件静默 undefined，损坏回落 undefined。 */
async function readLayer(
  file: string,
  label: string,
  log: ConfigLogger,
  knownKeys: readonly string[],
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
    where: file,
    onWarning: (msg) => log("warn", msg),
  });
  // 空文件/无 plugins 块也产出层（区别于读不到文件）：内容恒等价于空层，
  // 调用方按"文件存在"合并。为读取面最小语义，这里统一返回归一层。
  return layer;
}

/** 用户级配置：`<home>/.innocence/cordis.yml`（home 通常为 os.homedir()）。 */
export async function loadUserConfigLayer(
  home: string,
  log: ConfigLogger,
  knownKeys: readonly string[] = KNOWN_PLUGIN_KEYS,
): Promise<ConfigLayer | undefined> {
  return readLayer(path.join(home, ".innocence", "cordis.yml"), "user", log, knownKeys);
}

/** 项目级配置：`<root>/.innocence/plugins.yml`（布尔语义的声明式扩展）。 */
export async function loadProjectConfigLayer(
  root: string,
  log: ConfigLogger,
  knownKeys: readonly string[] = KNOWN_PLUGIN_KEYS,
): Promise<ConfigLayer | undefined> {
  return readLayer(path.join(root, ".innocence", "plugins.yml"), "project", log, knownKeys);
}

/** 一次性读齐两级配置层（用户 cordis.yml + 项目 plugins.yml）并合成用户层：
 *  cordis.yml 提供基础开关与 config 块，settings 开关（UI 管理面）按键覆盖；
 *  项目层独立返回（项目覆盖用户由 resolveEntries/resolvePluginSet 完成）。
 *  缺文件/损坏均回落（undefined 分量），不炸调用方。 */
export async function loadConfigLayerPair(
  home: string,
  workspaceRoot: string | undefined,
  settingsToggles: Record<string, boolean> | undefined,
  log: ConfigLogger,
): Promise<{ user: ConfigLayer; project: ConfigLayer | undefined }> {
  const [userFile, projectLayer] = await Promise.all([
    loadUserConfigLayer(home, log),
    workspaceRoot ? loadProjectConfigLayer(workspaceRoot, log) : Promise.resolve(undefined),
  ]);
  return {
    user: {
      toggles: { ...(userFile?.toggles ?? {}), ...(settingsToggles ?? {}) },
      configs: userFile?.configs ?? {},
    },
    project: projectLayer,
  };
}
