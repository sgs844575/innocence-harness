// 品牌/厂商图标解析：按「厂商标识/模型名关键词」匹配随包品牌图标集
// （assets/brandicons）。-color 变体存在时优先彩色，否则用单色（currentColor）。
const modules = import.meta.glob("../../../assets/brandicons/*.svg", {
  query: "?url",
  import: "default",
  eager: true,
}) as Record<string, string>;

const byName: ReadonlyMap<string, string> = new Map(
  Object.entries(modules).map(([path, url]) => [
    path.slice(path.lastIndexOf("/") + 1).replace(/\.svg$/, ""),
    url,
  ]),
);

/** 顺序即优先级：具体厂商在前，宽泛关键词（gpt/openai 系）在后。 */
const MATCHERS: readonly [RegExp, string][] = [
  [/anthropic|claude/i, "claude"],
  [/deepseek/i, "deepseek"],
  [/gemini|gemma|palm|bard|google/i, "gemini"],
  [/qwen|tongyi|wanx/i, "qwen"],
  [/zhipu|glm|chatglm|bigmodel/i, "zhipu"],
  [/moonshot|kimi/i, "moonshot"],
  [/mistral|mixtral/i, "mistral"],
  [/openrouter/i, "openrouter"],
  [/ollama|llama(?!.*groq)/i, "ollama"],
  [/groq/i, "groq"],
  [/grok|xai|x-ai/i, "xai"],
  [/hugging|hf-/i, "huggingface"],
  [/openai|gpt-|chatgpt|^o[134]$/i, "openai"],
];

/**
 * 按提供商标识或模型名解析品牌图标 URL；未命中返回 null（调用方回落）。
 */
export function resolveBrandIcon(subject: string, color = false): string | null {
  const hit = MATCHERS.find(([pattern]) => pattern.test(subject))?.[1];
  if (!hit) return null;
  return byName.get(color ? `${hit}-color` : hit) ?? byName.get(hit) ?? null;
}

export interface ResolvedBrand {
  url: string;
  /** 单色（currentColor）资产：暗色主题需反色（img 无 CSS 电流色上下文）。 */
  mono: boolean;
}

/** 带单色标记的解析：BrandIcon 据此决定是否套暗色反色滤镜。 */
export function resolveBrand(subject: string, color = false): ResolvedBrand | null {
  const hit = MATCHERS.find(([pattern]) => pattern.test(subject))?.[1];
  if (!hit) return null;
  const colorUrl = byName.get(`${hit}-color`);
  if (color && colorUrl) return { url: colorUrl, mono: false };
  const monoUrl = byName.get(hit);
  return monoUrl ? { url: monoUrl, mono: true } : null;
}

/** 供诊断/测试：品牌集内是否存在某图标名。 */
export function hasBrandIcon(name: string): boolean {
  return byName.has(name);
}
