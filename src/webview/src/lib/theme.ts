import type { ResolvedTheme, ThemeMode } from "../../../shared/ipc";

/** 主题类打在 <html> 上（.dark / 无类为浅色）；system 由 main 侧解析后推送。 */
export function applyTheme(resolved: ResolvedTheme): void {
  document.documentElement.classList.toggle("dark", resolved === "dark");
}

export type { ResolvedTheme, ThemeMode };
