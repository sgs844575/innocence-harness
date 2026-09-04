import { useEffect, useMemo, useState } from "react";
import { Streamdown } from "streamdown";
import { createShikiCodePlugin } from "../../lib/shikiPlugin";
import { createMermaidPlugin } from "../../lib/mermaidPlugin";
import { DEFAULT_CODE_THEME_DARK, DEFAULT_CODE_THEME_LIGHT } from "../../../../shared/codeThemes";

/** 代码外观（外观设置）：浅色/深色高亮主题对 + 行号开关。 */
export interface CodeAppearance {
  light: string;
  dark: string;
  lineNumbers: boolean;
}

/** Markdown 渲染（streamdown）；animated 用于流式尾段。
 *  高亮经 plugins.code 注入（streamdown 无内置高亮器）；主题对变更 →
 *  新插件引用 → streamdown 重算上下文并重新高亮。
 *  Mermaid 插件（plugins.mermaid）按 HTML 根 .dark 类选择主题；类名
 *  变化时刷新插件引用，触发已有的 mermaid 块重新渲染。 */
export function MarkdownView({
  source,
  animated,
  code,
  controls,
}: {
  source: string;
  animated?: boolean;
  code?: CodeAppearance;
  controls?: boolean;
}): React.JSX.Element {
  const light = code?.light ?? DEFAULT_CODE_THEME_LIGHT;
  const dark = code?.dark ?? DEFAULT_CODE_THEME_DARK;
  const plugin = useMemo(() => createShikiCodePlugin(light, dark), [light, dark]);
  // 订阅根 .dark 类变化：主题切换时重建 mermaid 插件引用，触发 streamdown 重渲。
  const [isDark, setIsDark] = useState(() => document.documentElement.classList.contains("dark"));
  useEffect(() => {
    const root = document.documentElement;
    const sync = () => setIsDark(root.classList.contains("dark"));
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);
  const mermaidPlugin = useMemo(() => createMermaidPlugin(), [isDark]);
  return (
    <div className="msg-body">
      <Streamdown
        animated={animated}
        mode={animated ? "streaming" : "static"}
        plugins={{ code: plugin, mermaid: mermaidPlugin }}
        {...(controls !== undefined ? { controls } : {})}
        {...(code ? { lineNumbers: code.lineNumbers } : {})}
      >
        {source}
      </Streamdown>
    </div>
  );
}
