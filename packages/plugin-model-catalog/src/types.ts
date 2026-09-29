// 模型清单条目属性形状：与 harness-electron 的 PresetModelMeta 对齐的能力
// 字段集。宿主在 cherry 预设层之上按"已定义字段覆盖"合并——本层未定义的
// 字段不触碰下层值。纯数据域：不依赖 Electron/渲染层/宿主路径。
//
// 注意：模型 id 本身是外部服务的标识符（等同依赖声明与 API 字符串），清单
// 数据必须携带真实 id 才能完成名称匹配；条目数值是默认值，用户改过的字段
// 以 dirty 标记保护（见设置 v3 归一化）。

/** 一条清单条目携带的模型属性（全部可选）。 */
export interface CatalogModelMeta {
  name?: string;
  contextWindow?: number;
  maxInput?: number;
  maxOutput?: number;
  /** 输入类型标记（文本为隐含默认，不设字段）。 */
  vision?: boolean;
  video?: boolean;
  pdf?: boolean;
  /** 工具调用能力。 */
  tools?: boolean;
  /** 思考/推理能力与档位（openai reasoning_effort 风格，从低到高）。 */
  reasoning?: boolean;
  reasoningEfforts?: string[];
  /** 思考档位 → 接口参数值映射（键为档位名，如 {"max": "xhigh"}）。 */
  reasoningParamMap?: Record<string, string>;
  /** 能力开关标记（对接入方未声明支持时留空）。 */
  structuredOutput?: boolean;
  webSearch?: boolean;
  systemMessage?: boolean;
  streaming?: boolean;
}

/**
 * 一条清单条目：规范 id 精确匹配 + 家族 pattern 模糊匹配（归一化形态）。
 * 匹配顺序：精确（原始 → 归一化）→ 去厂商前缀归一化 → pattern（数组
 * 顺序即优先级，特异家族条目须排在宽泛家族条目之前）。
 */
export interface CatalogModelEntry {
  /** 规范模型 id（精确匹配键，可用原始写法如 "gemini-2.5-pro"）。 */
  id: string;
  /** 家族正则源串，匹配 normalizeCatalogModelId 输出（点/下划线已归一连字符）。 */
  pattern?: string;
  meta: CatalogModelMeta;
}
