// 模型清单宿主适配测试：净化（不可信插件输出）、boot 装载降级、cherry +
// 清单按字段合并。
import { describe, expect, it, vi } from "vitest";
import { matchModelCatalog, mergeModelMeta, sanitizeCatalogMeta } from "./modelCatalog";
import { MODEL_CATALOG, matchCatalogEntry } from "@innocenceharness/plugin-model-catalog";

describe("sanitizeCatalogMeta", () => {
  it("保留合法字段、剔除非法形状", () => {
    expect(
      sanitizeCatalogMeta({
        name: "GPT-5",
        contextWindow: 400000,
        maxOutput: -1,
        vision: true,
        video: "yes",
        pdf: true,
        reasoningEfforts: ["low", " ", 3],
        reasoningParamMap: { max: "xhigh" },
        structuredOutput: true,
      }),
    ).toEqual({
      name: "GPT-5",
      contextWindow: 400000,
      vision: true,
      pdf: true,
      reasoningEfforts: ["low"],
      reasoningParamMap: { max: "xhigh" },
      structuredOutput: true,
    });
  });

  it("非法参数映射整体丢弃；空对象/数组/原始值 → 空 meta", () => {
    expect(sanitizeCatalogMeta({ reasoningParamMap: { max: 3 } })).toEqual({});
    expect(sanitizeCatalogMeta({ reasoningParamMap: {} })).toEqual({});
    expect(sanitizeCatalogMeta(null)).toEqual({});
    expect(sanitizeCatalogMeta([])).toEqual({});
    expect(sanitizeCatalogMeta("gpt-5")).toEqual({});
  });
});

describe("matchModelCatalog（boot 装载）", () => {
  // 模拟 staged 插件的 default export 形态（对象插件 + 数据面属性）。
  const boot = {
    importPlugin: async () => ({
      name: "model-catalog",
      apply: () => {},
      matchModel: matchCatalogEntry,
      catalog: MODEL_CATALOG,
    }),
  };

  it("命中清单条目并净化 meta", async () => {
    const hit = await matchModelCatalog(boot, "gpt-5.1-mini");
    expect(hit?.id).toBe("gpt-5");
    expect(hit?.meta.contextWindow).toBe(400000);
    expect(hit?.meta.reasoningParamMap).toEqual({ max: "xhigh" });
  });

  it("未命中返回 meta 为空对象的结果（合并层按无覆盖处理）", async () => {
    const hit = await matchModelCatalog(boot, "totally-unknown");
    expect(hit).toBeUndefined();
  });

  it("插件缺席/装载失败 → undefined 降级", async () => {
    const failing = { importPlugin: async () => Promise.reject(new Error("missing")) };
    await expect(matchModelCatalog(failing, "gpt-5")).resolves.toBeUndefined();
    const noFace = { importPlugin: async () => ({ name: "other" }) };
    await expect(matchModelCatalog(noFace, "gpt-5")).resolves.toBeUndefined();
  });

  it("每次匹配都经 boot 装载（resolver 的 ESM 模块缓存保证幂等）", async () => {
    const importPlugin = vi.fn(boot.importPlugin);
    await matchModelCatalog({ importPlugin }, "gpt-5");
    await matchModelCatalog({ importPlugin }, "o3");
    expect(importPlugin).toHaveBeenCalledTimes(2);
  });
});

describe("mergeModelMeta", () => {
  it("清单已定义字段覆盖 cherry，未定义字段保留 cherry 值", () => {
    const merged = mergeModelMeta(
      { contextWindow: 128000, maxOutput: 16384, tools: true },
      { contextWindow: 400000, reasoning: true },
      "gpt-5",
    );
    expect(merged).toMatchObject({
      id: "gpt-5",
      source: "preset",
      contextWindow: 400000,
      maxOutput: 16384,
      tools: true,
      reasoning: true,
    });
  });

  it("两层皆无元数据 → 最小 fetch 对象（不误标 preset）", () => {
    expect(mergeModelMeta(undefined, undefined, "mystery")).toEqual({ id: "mystery", source: "fetch" });
    expect(mergeModelMeta(undefined, {}, "mystery")).toEqual({ id: "mystery", source: "fetch" });
  });

  it("仅清单命中也产出 preset 对象", () => {
    expect(mergeModelMeta(undefined, { vision: true }, "x")).toMatchObject({ source: "preset", vision: true });
  });
});
