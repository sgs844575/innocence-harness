export const BROWSER_PARTITION = "persist:browser";

export type BrowserDataKind = "cache" | "all";
export type BrowserDataResult = { ok: true } | { ok: false; error: string };
