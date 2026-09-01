// Font-scale glue: writes the two size tokens onto <html> so the whole tree
// (including settings UI itself) re-scales live. CSS defaults live in
// tokens/semantic.css (:root) — 14px both — so first paint and bridge-missing
// renders (tests/plain browser) are covered before settings load.
export const FONT_SIZE_DEFAULT = 14;

export function applyFontScale(uiFontSize: number, codeFontSize: number): void {
  const root = document.documentElement;
  root.style.setProperty("--font-size-ui", `${uiFontSize}px`);
  root.style.setProperty("--font-size-code", `${codeFontSize}px`);
}
