// 终端字体：挂载与设置（terminalFontFamily/terminalInheritProfile）变更时向 main
// 现算生效字体（显式覆盖 > 继承系统终端字体 > null）。null = 加载中/无覆盖/桥缺失
// （测试/纯浏览器）/解析失败——终端保持 --font-mono token 的现状行为。
import { useEffect, useState } from "react";
import type { HarnessSettings } from "../../../shared/ipc";
import { api, hasBridge } from "../lib/ipc";

/** 生效终端字体（main 现算）；消费方把 null/空串当作「沿用 token 默认」。 */
export function useTerminalFont(settings: HarnessSettings | null): string | null {
  const [font, setFont] = useState<string | null>(null);
  const family = settings?.terminalFontFamily;
  const inherit = settings?.terminalInheritProfile;

  useEffect(() => {
    if (!hasBridge()) return;
    // 竞态防护：设置再变（effect 重跑）或卸载后，上一班次的迟到响应丢弃。
    let stale = false;
    void api
      .getTerminalFont()
      .then((resolved: string | null) => {
        if (!stale) setFont(resolved);
      })
      .catch(() => {
        if (!stale) setFont(null);
      });
    return () => {
      stale = true;
    };
  }, [family, inherit]);

  return font;
}
