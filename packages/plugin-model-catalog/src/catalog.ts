// 内置模型清单数据：市面常用模型家族的属性表。数值与能力是【默认值】，
// 供两处消费——拉取模型后的自动勾选配置（导入弹窗）与添加模型的智能配置
// 匹配；用户改过的字段以 dirty 保护，清单永不覆盖。
//
// 匹配形态（见 match.ts）：条目 id 精确命中（原始/归一化），未命中再走
// pattern 家族模糊匹配（对归一化 id，点/下划线已变连字符、已去网关厂商
// 前缀，如 "zai-org/GLM-4.6" → "glm-4-6"）。pattern 命中只填家族稳定
// 字段：数值随变体漂移大的家族（qwen/llama 等）不预填上下文/输出，交给
// cherry 精确层或用户输入。特异条目（视觉变体、思考变体）排在宽泛家族
// 条目之前——pattern 按数组顺序取首个命中。
import type { CatalogModelEntry } from "./types";

export const MODEL_CATALOG: CatalogModelEntry[] = [
  // ---- OpenAI 系 ------------------------------------------------------------
  {
    // gpt-5 家族：视觉/PDF 输入、工具、思考三档；"max" 档映射为接口的 xhigh。
    id: "gpt-5",
    pattern: "^gpt-5",
    meta: {
      contextWindow: 400000,
      maxOutput: 128000,
      vision: true,
      pdf: true,
      tools: true,
      reasoning: true,
      reasoningEfforts: ["low", "medium", "high"],
      reasoningParamMap: { max: "xhigh" },
      structuredOutput: true,
      webSearch: true,
      systemMessage: true,
    },
  },
  {
    id: "gpt-4.1",
    pattern: "^gpt-4-1",
    meta: {
      contextWindow: 1047576,
      maxOutput: 32768,
      vision: true,
      tools: true,
      structuredOutput: true,
      systemMessage: true,
    },
  },
  {
    id: "gpt-4o",
    pattern: "^gpt-4o",
    meta: {
      contextWindow: 128000,
      maxOutput: 16384,
      vision: true,
      tools: true,
      structuredOutput: true,
      systemMessage: true,
    },
  },
  {
    // o 系思考模型（o1/o3/o4-mini 及日期变体）：无视觉、低延迟档三档。
    id: "o3",
    pattern: "^o[134](-|$)",
    meta: {
      contextWindow: 200000,
      maxOutput: 100000,
      tools: true,
      reasoning: true,
      reasoningEfforts: ["low", "medium", "high"],
      structuredOutput: true,
      systemMessage: true,
    },
  },
  // ---- Anthropic 系 ---------------------------------------------------------
  {
    // 4.5+ 家族：文档（PDF）输入、思考档位（effort 参数）。
    id: "claude-sonnet-4-5",
    pattern: "^claude-(opus|sonnet|haiku)-4-[5-9]",
    meta: {
      contextWindow: 200000,
      maxOutput: 32000,
      vision: true,
      pdf: true,
      tools: true,
      reasoning: true,
      reasoningEfforts: ["low", "medium", "high"],
      structuredOutput: true,
      systemMessage: true,
    },
  },
  {
    // 4.0–4.2 家族：无档位式思考（扩展思考走预算，不按档位声明）。
    id: "claude-sonnet-4",
    pattern: "^claude-(opus|sonnet|haiku)-4(-[0-4]|$)",
    meta: {
      contextWindow: 200000,
      maxOutput: 32000,
      vision: true,
      pdf: true,
      tools: true,
      structuredOutput: true,
      systemMessage: true,
    },
  },
  {
    id: "claude-3-5-sonnet",
    pattern: "^claude-3-[5-7]",
    meta: {
      contextWindow: 200000,
      maxOutput: 8192,
      vision: true,
      pdf: true,
      tools: true,
      systemMessage: true,
    },
  },
  // ---- Gemini 系 ------------------------------------------------------------
  {
    // 2.5 家族：原生视频/PDF 理解、思考档位（low/high）、搜索接地。
    id: "gemini-2.5-pro",
    pattern: "^gemini-2-5",
    meta: {
      contextWindow: 1048576,
      maxOutput: 65536,
      vision: true,
      video: true,
      pdf: true,
      tools: true,
      reasoning: true,
      reasoningEfforts: ["low", "high"],
      structuredOutput: true,
      webSearch: true,
      systemMessage: true,
    },
  },
  {
    id: "gemini-2.0-flash",
    pattern: "^gemini-(2-0|1-5)",
    meta: {
      contextWindow: 1048576,
      maxOutput: 8192,
      vision: true,
      video: true,
      pdf: true,
      tools: true,
      structuredOutput: true,
      webSearch: true,
      systemMessage: true,
    },
  },
  // ---- DeepSeek 系 ----------------------------------------------------------
  {
    id: "deepseek-chat",
    pattern: "^deepseek-(chat|v3)",
    meta: {
      contextWindow: 131072,
      maxOutput: 8192,
      tools: true,
      structuredOutput: true,
      systemMessage: true,
    },
  },
  {
    // 思考模型：接口不接受 system 角色消息——systemMessage 有意不声明。
    id: "deepseek-reasoner",
    pattern: "^deepseek-(reasoner|r1)",
    meta: {
      contextWindow: 131072,
      maxOutput: 8192,
      reasoning: true,
      tools: true,
    },
  },
  // ---- 通义 qwen 系（数值随变体漂移大，pattern 只给能力） ---------------------
  {
    id: "qwen-vl-max",
    pattern: "^qwen.*vl",
    meta: { vision: true, tools: true, systemMessage: true },
  },
  {
    // qwen3 思考开关家族（enable_thinking）；档位未标准化，不列 efforts。
    id: "qwen3-max",
    pattern: "^qwen3",
    meta: { tools: true, reasoning: true, structuredOutput: true, systemMessage: true },
  },
  {
    id: "qwen-plus",
    pattern: "^qwen",
    meta: { tools: true, structuredOutput: true, systemMessage: true },
  },
  // ---- 智谱 glm 系 ----------------------------------------------------------
  {
    // 4.5+ 思考家族（thinking 开关 + 预算）；端点接受透传档位，max 直收。
    id: "glm-4.6",
    pattern: "^glm-4-[5-9]",
    meta: {
      contextWindow: 200000,
      maxOutput: 8192,
      tools: true,
      reasoning: true,
      structuredOutput: true,
      systemMessage: true,
    },
  },
  {
    id: "glm-4-plus",
    pattern: "^glm-4",
    meta: { tools: true, structuredOutput: true, systemMessage: true },
  },
  // ---- 月之暗面 kimi 系 ------------------------------------------------------
  {
    id: "kimi-k2",
    pattern: "^(kimi|moonshot)",
    meta: {
      contextWindow: 262144,
      maxOutput: 16384,
      tools: true,
      structuredOutput: true,
      systemMessage: true,
    },
  },
  // ---- xAI grok 系 ----------------------------------------------------------
  {
    // 视觉变体排在通用家族之前（特异优先）。
    id: "grok-2-vision-1212",
    pattern: "^grok.*vision",
    meta: { vision: true, tools: true, systemMessage: true },
  },
  {
    id: "grok-4",
    pattern: "^grok-[2-9]",
    meta: {
      contextWindow: 256000,
      maxOutput: 32768,
      tools: true,
      reasoning: true,
      structuredOutput: true,
      systemMessage: true,
    },
  },
  // ---- Mistral 系 -----------------------------------------------------------
  {
    id: "pixtral-large-latest",
    pattern: "^pixtral",
    meta: { vision: true, tools: true, systemMessage: true },
  },
  {
    id: "mistral-large-latest",
    pattern: "^mistral",
    meta: {
      contextWindow: 131072,
      maxOutput: 8192,
      tools: true,
      structuredOutput: true,
      systemMessage: true,
    },
  },
  // ---- 开放权重与国内云系（部署差异大：只给能力，不预填数值） ----------------
  {
    id: "llama3.1",
    pattern: "^llama",
    meta: { tools: true, systemMessage: true },
  },
  {
    id: "doubao-pro-32k",
    pattern: "^doubao",
    meta: { tools: true, structuredOutput: true, systemMessage: true },
  },
];
