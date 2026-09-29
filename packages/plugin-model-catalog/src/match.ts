// 清单匹配：精确（原始 → 归一化）→ 去厂商前缀归一化 → 家族 pattern
// （数组顺序优先）。厂家无关——网关/中转站名下任何家的模型 id 都能命中。
import { MODEL_CATALOG } from "./catalog";
import type { CatalogModelEntry } from "./types";

/**
 * 归一化模型 id：去网关厂商前缀（取最后一个路径段，如
 * "openai/gpt-5"、"deepseek-ai/DeepSeek-V3.2"）、点/下划线 → 连字符、
 * 小写。清单 pattern 一律针对该形态书写。
 */
export function normalizeCatalogModelId(id: string): string {
  const stripped = id.includes("/") ? id.slice(id.lastIndexOf("/") + 1) : id;
  return stripped.replace(/[._]/g, "-").toLowerCase();
}

/** 精确索引：原始 id 与归一化 id 双键（同键首条胜出 = 条目顺序优先）。 */
const EXACT = new Map<string, CatalogModelEntry>();
/** 家族 pattern（构造失败的正则跳过，不让单条坏数据拖垮匹配）。 */
const PATTERNS: { entry: CatalogModelEntry; re: RegExp }[] = [];

for (const entry of MODEL_CATALOG) {
  if (!EXACT.has(entry.id)) EXACT.set(entry.id, entry);
  const normalizedKey = normalizeCatalogModelId(entry.id);
  if (!EXACT.has(normalizedKey)) EXACT.set(normalizedKey, entry);
  if (entry.pattern) {
    try {
      PATTERNS.push({ entry, re: new RegExp(entry.pattern) });
    } catch {
      // 单条 pattern 非法：跳过（该条目仍保留精确匹配）。
    }
  }
}

/** 按模型名称匹配清单条目；未命中返回 undefined。 */
export function matchCatalogEntry(modelId: string): CatalogModelEntry | undefined {
  const raw = modelId.trim();
  if (!raw) return undefined;
  return (
    EXACT.get(raw) ??
    EXACT.get(normalizeCatalogModelId(raw)) ??
    PATTERNS.find(({ re }) => re.test(normalizeCatalogModelId(raw)))?.entry
  );
}
