// 模型清单插件（数据载体形态）：预设市面常用模型的属性清单，供宿主设置
// enrichment（拉取模型自动配置、添加模型智能配置）按名称匹配。有意不进
// 内置清单 manifest（同 provider-* 工厂位）：无会话面（不注册工具/处理器/
// 提示词），宿主经 boot.importPlugin 读取 default export 上的 catalog 与
// matchModel 数据面（同 subagent.catalog 先例）。
import type { Context } from "@innocenceharness/kernel";
import { MODEL_CATALOG } from "./catalog";
import { matchCatalogEntry } from "./match";

export type { CatalogModelEntry, CatalogModelMeta } from "./types";
export { MODEL_CATALOG } from "./catalog";
export { matchCatalogEntry, normalizeCatalogModelId } from "./match";

export const ModelCatalogPlugin = {
  name: "model-catalog",
  apply(_ctx: Context) {
    // 数据插件：宿主消费数据面；装载校验要求插件形态（apply 存在），会话
    // 面保持空实现。
  },
};

export default Object.assign(ModelCatalogPlugin, {
  catalog: MODEL_CATALOG,
  matchModel: matchCatalogEntry,
});
