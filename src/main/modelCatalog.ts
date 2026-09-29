// 模型清单宿主适配：经 boot 的批准双根装载 plugin-model-catalog（数据
// 载体形态，同 subagent.catalog 先例），把清单匹配结果按"已定义字段覆盖"
// 合并到 cherry 预设层之上。装载/匹配失败一律按"无清单"降级（enrich 仍走
// cherry 层），绝不阻断拉取/添加流程。插件输出按不可信输入净化。
import type { ModelInfo, PresetModelMeta } from "@innocenceharness/harness-electron";
import type { PluginBoot } from "./pluginBoot";

/** 宿主侧匹配结果：命中的清单条目 id + 净化后的已定义字段集。 */
export interface ResolvedCatalogMatch {
  id: string;
  meta: Partial<PresetModelMeta>;
}

const num = (v: unknown): number | undefined => (typeof v === "number" && v > 0 ? v : undefined);
const bool = (v: unknown): boolean | undefined => (v === true ? true : undefined);
const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() !== "" ? v : undefined);

const efforts = (v: unknown): string[] | undefined => {
  if (!Array.isArray(v)) return undefined;
  const list = v.filter((item): item is string => typeof item === "string" && item.trim() !== "").map((item) => item.trim());
  return list.length > 0 ? list : undefined;
};

const paramMap = (v: unknown): Record<string, string> | undefined => {
  if (!v || typeof v !== "object" || Array.isArray(v)) return undefined;
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(v as Record<string, unknown>)) {
    if (typeof value !== "string" || value === "") return undefined;
    out[key] = value;
  }
  return Object.keys(out).length > 0 ? out : undefined;
};

/** 净化清单条目 meta（插件输出不可信）：只保留合法形状的已定义字段。 */
export function sanitizeCatalogMeta(raw: unknown): Partial<PresetModelMeta> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const src = raw as Record<string, unknown>;
  const out: Partial<PresetModelMeta> = {};
  const name = str(src.name);
  if (name !== undefined) out.name = name;
  const contextWindow = num(src.contextWindow);
  if (contextWindow !== undefined) out.contextWindow = contextWindow;
  const maxInput = num(src.maxInput);
  if (maxInput !== undefined) out.maxInput = maxInput;
  const maxOutput = num(src.maxOutput);
  if (maxOutput !== undefined) out.maxOutput = maxOutput;
  for (const key of ["vision", "video", "pdf", "tools", "reasoning", "structuredOutput", "webSearch", "systemMessage"] as const) {
    const value = bool(src[key]);
    if (value !== undefined) out[key] = value;
  }
  const levels = efforts(src.reasoningEfforts);
  if (levels !== undefined) out.reasoningEfforts = levels;
  const mapping = paramMap(src.reasoningParamMap);
  if (mapping !== undefined) out.reasoningParamMap = mapping;
  return out;
}

/**
 * 经 boot 装载模型清单并匹配单个模型 id。插件缺席、装载失败或形状非法
 * 都返回 undefined（调用方降级到 cherry 层）。
 */
export async function matchModelCatalog(
  boot: Pick<PluginBoot, "importPlugin">,
  modelId: string,
): Promise<ResolvedCatalogMatch | undefined> {
  let carrier: { matchModel?: (id: string) => unknown };
  try {
    carrier = (await boot.importPlugin("model-catalog")) as { matchModel?: (id: string) => unknown };
  } catch {
    return undefined;
  }
  if (!carrier || typeof carrier.matchModel !== "function") return undefined;
  const hit = carrier.matchModel(modelId) as { id?: unknown; meta?: unknown } | undefined;
  if (!hit || typeof hit.id !== "string" || hit.id === "") return undefined;
  return { id: hit.id, meta: sanitizeCatalogMeta(hit.meta) };
}

/**
 * cherry 预设层 + 清单层的按字段合并（清单已定义字段覆盖，未定义字段
 * 保留 cherry 值）；两层皆无元数据 → undefined（最小 fetch 对象由调用方
 * 生成）。返回对象始终带 name：清单/cherry 命中的展示名优先于裸 id。
 */
export function mergeModelMeta(
  preset: PresetModelMeta | undefined,
  catalog: Partial<PresetModelMeta> | undefined,
  modelId: string,
): ModelInfo | { id: string; source: "fetch" } {
  const merged = { ...(preset ?? {}), ...(catalog ?? {}) } as Partial<PresetModelMeta>;
  if (Object.keys(merged).length === 0) return { id: modelId, source: "fetch" };
  return { id: modelId, source: "preset", ...merged };
}
