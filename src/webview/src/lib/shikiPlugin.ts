// Shiki 代码高亮插件（streamdown plugins.code 协议）：streamdown 本体不内置
// 高亮器，代码主题/行号只有注入 CodeHighlighterPlugin 才生效。
// 用 JavaScript regex 引擎（无 WASM，CSP 安全）；主题/语言按首次使用懒加载；
// 未就绪时返回 null（streamdown 先显示原文），就绪后经回调替换为高亮结果。
import { createHighlighter, createJavaScriptRegexEngine, type Highlighter } from "shiki";
import type { BundledLanguage, BundledTheme, CodeHighlighterPlugin, ThemeInput } from "streamdown";
import { DEFAULT_CODE_THEME_DARK, DEFAULT_CODE_THEME_LIGHT } from "../../../shared/codeThemes";

/** 预加载语言（覆盖会话常见代码块）；其余语言首次见到时懒加载，失败回落 text。 */
const PRELOAD_LANGS = [
  "text", "typescript", "tsx", "javascript", "jsx", "json", "jsonc",
  "bash", "shell", "python", "css", "html", "markdown", "yaml", "diff",
  "sql", "go", "rust", "java", "c", "cpp", "xml",
] as const;

let highlighterPromise: Promise<Highlighter> | null = null;
const loadedThemes = new Set<string>();
const loadedLangs = new Set<string>();
/** 加载失败的语言（走 text 回落，不再重试）。 */
const failedLangs = new Set<string>();

function acquireHighlighter(): Promise<Highlighter> {
  highlighterPromise ??= createHighlighter({
    themes: [DEFAULT_CODE_THEME_LIGHT, DEFAULT_CODE_THEME_DARK],
    langs: [...PRELOAD_LANGS] as BundledLanguage[],
    engine: createJavaScriptRegexEngine(),
  }).then((highlighter) => {
    loadedThemes.add(DEFAULT_CODE_THEME_LIGHT);
    loadedThemes.add(DEFAULT_CODE_THEME_DARK);
    for (const lang of PRELOAD_LANGS) loadedLangs.add(lang);
    return highlighter;
  });
  return highlighterPromise;
}

/** 主题/语言按需补齐；语言加载失败回落 text（未知 fence 不炸高亮）。 */
async function ensureReady(themes: [string, string], language: string): Promise<Highlighter> {
  const highlighter = await acquireHighlighter();
  for (const theme of themes) {
    if (!loadedThemes.has(theme)) {
      await highlighter.loadTheme(theme as BundledTheme);
      loadedThemes.add(theme);
    }
  }
  if (!loadedLangs.has(language) && !failedLangs.has(language)) {
    try {
      await highlighter.loadLanguage(language as BundledLanguage);
      loadedLangs.add(language);
    } catch {
      failedLangs.add(language);
    }
  }
  return highlighter;
}

function isReady(themes: [string, string], language: string): boolean {
  const langReady = loadedLangs.has(language) || failedLangs.has(language);
  return readyCache !== null && themes.every((theme) => loadedThemes.has(theme)) && langReady;
}

/** 语言归一： fence 别名（ts/js/sh/py…）与 text 回落。 */
function normalizeLanguage(language: string): string {
  const alias: Record<string, string> = {
    ts: "typescript",
    js: "javascript",
    py: "python",
    sh: "bash",
    zsh: "bash",
    md: "markdown",
    yml: "yaml",
    plaintext: "text",
  };
  return alias[language] ?? language;
}

/** shiki 双主题下 fg/bg 是 "light;--shiki-dark(-bg):dark" 复合串，拆成浅/深两值。 */
function compoundPair(value: string | undefined): { light: string; dark: string } | undefined {
  if (!value) return undefined;
  const [light, darkDecl] = value.split(";");
  const dark = darkDecl?.split(":")[1]?.trim();
  return { light: light.trim(), dark: dark ?? light.trim() };
}

export function createShikiCodePlugin(light: string, dark: string): CodeHighlighterPlugin {
  const pair: [ThemeInput, ThemeInput] = [light as BundledTheme, dark as BundledTheme];
  return {
    name: "shiki",
    type: "code-highlighter",
    getSupportedLanguages: () => [...loadedLangs] as BundledLanguage[],
    getThemes: () => pair,
    supportsLanguage: (language) => loadedLangs.has(language),
    highlight(options, callback) {
      // streamdown 传入的 themes 即上下文主题对（来自 getThemes 覆盖或 prop）。
      const themes: [string, string] = [
        typeof options.themes[0] === "string" ? options.themes[0] : light,
        typeof options.themes[1] === "string" ? options.themes[1] : dark,
      ];
      const language = normalizeLanguage(options.language);
      const produce = (highlighter: Highlighter) => {
        const effectiveLang = loadedLangs.has(language) ? language : "text";
        const result = highlighter.codeToTokens(options.code, {
          lang: effectiveLang as BundledLanguage,
          themes: { light: themes[0] as BundledTheme, dark: themes[1] as BundledTheme },
          defaultColor: "light",
        });
        // 主题底色只经 CSS 变量下发（浅槽 + 深槽，深槽由全局样式在暗色下消费）。
        // 不写内联 background-color/color：内联样式压过代码块容器的主题切换
        // 规则，会导致暗色模式下代码块停留在浅色白底。
        const bg = compoundPair(result.bg);
        const rootStyle = bg
          ? `--sdm-bg: ${bg.light}; --shiki-dark-bg: ${bg.dark};`
          : "";
        return { tokens: result.tokens, rootStyle: rootStyle || undefined } as never;
      };
      if (isReady(themes, language) && readyCache) return produce(readyCache) as never;
      void ensureReady(themes, language)
        .then((highlighter) => {
          readyCache = highlighter;
          callback?.(produce(highlighter) as never);
        })
        .catch(() => undefined);
      return null;
    },
  };
}

/** createHighlighter 解析后的同步引用（highlight 的同步路径用）。 */
let readyCache: Highlighter | null = null;
void acquireHighlighter().then((h) => {
  readyCache = h;
});
