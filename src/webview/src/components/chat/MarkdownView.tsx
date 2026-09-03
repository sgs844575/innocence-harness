import { useMemo } from "react";
import { Streamdown } from "streamdown";
import { createShikiCodePlugin } from "../../lib/shikiPlugin";

/** 代码外观（外观设置）：浅色/深色高亮主题对 + 行号开关。 */
export interface CodeAppearance {
  light: string;
  dark: string;
  lineNumbers: boolean;
}

/** Markdown 渲染（streamdown）；animated 用于流式尾段。
 *  高亮经 plugins.code 注入（streamdown 无内置高亮器）；主题对变更 →
 *  新插件引用 → streamdown 重算上下文并重新高亮。 */
export function MarkdownView({
  source,
  animated,
  code,
}: {
  source: string;
  animated?: boolean;
  code?: CodeAppearance;
}): React.JSX.Element {
  const light = code?.light ?? "github-light";
  const dark = code?.dark ?? "github-dark";
  const plugin = useMemo(() => createShikiCodePlugin(light, dark), [light, dark]);
  return (
    <div className="msg-body">
      <Streamdown
        animated={animated}
        mode={animated ? "streaming" : "static"}
        plugins={{ code: plugin }}
        {...(code ? { lineNumbers: code.lineNumbers } : {})}
      >
        {source}
      </Streamdown>
    </div>
  );
}
