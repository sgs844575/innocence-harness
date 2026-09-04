// Mermaid 图表渲染插件（streamdown plugins.mermaid 协议）：主题随 .dark 类切换。
// mermaid 由 streamdown 内置依赖（无需单独安装），通过动态 import 懒加载；
// 主题配置随 HTML 根类变化重建插件实例，触发 MarkdownView 的 useMemo 重算。
import type { DiagramPlugin } from "streamdown";
import type { Mermaid, MermaidConfig } from "mermaid";

/** Mermaid 内置主题：dark 对应 "dark"，light 对应 "default"。 */
const THEME_LIGHT = "default";
const THEME_DARK = "dark";

let mermaidInstance: Mermaid | null = null;

/** 懒加载 mermaid 实例（首次调用时 import）。 */
async function acquireMermaid(): Promise<Mermaid> {
  if (mermaidInstance === null) {
    const mod = await import("mermaid");
    mermaidInstance = mod.default;
  }
  return mermaidInstance;
}

/** 创建 mermaid 插件：主题由当前 .dark 类决定（暗色 = "dark"，浅色 = "default"）。
 *  主题切换后调用方需重建插件引用，触发 streamdown 重新渲染。 */
export function createMermaidPlugin(): DiagramPlugin {
  const isDark = document.documentElement.classList.contains("dark");
  const theme = isDark ? THEME_DARK : THEME_LIGHT;

  return {
    name: "mermaid",
    type: "diagram",
    language: "mermaid",
    getMermaid: (userConfig?: MermaidConfig) => {
      const config: MermaidConfig = {
        startOnLoad: false,
        theme,
        ...userConfig,
      };
      return {
        initialize: (cfg: MermaidConfig) => {
          void acquireMermaid().then((api) => api.initialize({ ...config, ...cfg }));
        },
        render: async (id: string, source: string) => {
          const api = await acquireMermaid();
          api.initialize(config);
          return api.render(id, source);
        },
      };
    },
  };
}
