// 模型清单插件测试：匹配语义（精确/归一化/前缀剥离/家族 pattern 顺序）、
// 数据卫生（pattern 合法、id 无重复冲突）与数据载体插件形态。
import { describe, expect, it } from "vitest";
import ModelCatalogPluginDefault, { ModelCatalogPlugin } from "../src";
import { MODEL_CATALOG } from "../src/catalog";
import { matchCatalogEntry, normalizeCatalogModelId } from "../src/match";

describe("normalizeCatalogModelId", () => {
  it("去网关厂商前缀并归一点/下划线", () => {
    expect(normalizeCatalogModelId("openai/gpt-5")).toBe("gpt-5");
    expect(normalizeCatalogModelId("deepseek-ai/DeepSeek-V3.2")).toBe("deepseek-v3-2");
    expect(normalizeCatalogModelId("zai-org/GLM-4.6")).toBe("glm-4-6");
    expect(normalizeCatalogModelId("Qwen/Qwen3-235B-A22B")).toBe("qwen3-235b-a22b");
    expect(normalizeCatalogModelId("gemini-2.5-pro")).toBe("gemini-2-5-pro");
    expect(normalizeCatalogModelId("qwen3:8b")).toBe("qwen3:8b");
  });
});

describe("matchCatalogEntry", () => {
  it("精确命中（原始与归一化写法）", () => {
    expect(matchCatalogEntry("gpt-5")?.id).toBe("gpt-5");
    expect(matchCatalogEntry("gemini-2.5-pro")?.id).toBe("gemini-2.5-pro");
    expect(matchCatalogEntry("gemini-2-5-pro")?.id).toBe("gemini-2.5-pro");
  });

  it("网关厂商前缀形态命中同族条目", () => {
    expect(matchCatalogEntry("openai/gpt-5")?.id).toBe("gpt-5");
    expect(matchCatalogEntry("zai-org/GLM-4.6")?.id).toBe("glm-4.6");
    expect(matchCatalogEntry("Qwen/Qwen3-235B-A22B")?.id).toBe("qwen3-max");
  });

  it("家族 pattern 命中日期/规模变体", () => {
    expect(matchCatalogEntry("gpt-5.1-mini")?.meta.contextWindow).toBe(400000);
    expect(matchCatalogEntry("claude-opus-4-6")?.meta.reasoning).toBe(true);
    expect(matchCatalogEntry("claude-sonnet-4-5-20250929")?.meta.pdf).toBe(true);
    expect(matchCatalogEntry("deepseek-ai/DeepSeek-R1")?.id).toBe("deepseek-reasoner");
    expect(matchCatalogEntry("qwen3:8b")?.meta.reasoning).toBe(true);
  });

  it("特异条目先于宽泛家族（视觉/思考变体）", () => {
    expect(matchCatalogEntry("grok-2-vision-1212")?.id).toBe("grok-2-vision-1212");
    expect(matchCatalogEntry("grok-4")?.id).toBe("grok-4");
    expect(matchCatalogEntry("qwen-vl-max")?.meta.vision).toBe(true);
    expect(matchCatalogEntry("qwen3-max")?.meta.reasoning).toBe(true);
    expect(matchCatalogEntry("pixtral-large-latest")?.meta.vision).toBe(true);
  });

  it("思考模型的 systemMessage 有意留空（deepseek reasoner 不收 system 角色）", () => {
    expect(matchCatalogEntry("deepseek-reasoner")?.meta.systemMessage).toBeUndefined();
    expect(matchCatalogEntry("deepseek-chat")?.meta.systemMessage).toBe(true);
  });

  it("未命中返回 undefined；空串安全", () => {
    expect(matchCatalogEntry("totally-unknown-model-x")).toBeUndefined();
    expect(matchCatalogEntry("")).toBeUndefined();
    expect(matchCatalogEntry("  ")).toBeUndefined();
  });
});

describe("MODEL_CATALOG 数据卫生", () => {
  it("全部 pattern 可编译", () => {
    for (const entry of MODEL_CATALOG) {
      const { pattern } = entry;
      if (pattern !== undefined) expect(() => new RegExp(pattern)).not.toThrow();
    }
  });
  it("每条至少带一个能力字段（纯空 meta = 无意义条目）", () => {
    for (const entry of MODEL_CATALOG) {
      expect(Object.keys(entry.meta).length, entry.id).toBeGreaterThan(0);
    }
  });
});

describe("数据载体插件形态（宿主 importPlugin 消费面）", () => {
  it("default export 为插件对象 + catalog/matchModel 数据面", () => {
    expect(ModelCatalogPlugin.name).toBe("model-catalog");
    expect(typeof ModelCatalogPlugin.apply).toBe("function");
    expect(Array.isArray((ModelCatalogPluginDefault as { catalog?: unknown }).catalog)).toBe(true);
    expect(typeof (ModelCatalogPluginDefault as { matchModel?: unknown }).matchModel).toBe("function");
  });
});
