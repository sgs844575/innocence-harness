import { describe, expect, it } from "vitest";
import { createShikiCodePlugin } from "./shikiPlugin";

interface Tokenish {
  content: string;
  color?: string;
  htmlStyle?: Record<string, string>;
}

describe("shiki code plugin", () => {
  it("产出带浅/深双主题色的 token（懒加载主题经回调交付）", async () => {
    const plugin = createShikiCodePlugin("one-light", "dracula");
    expect(plugin.getThemes()).toEqual(["one-light", "dracula"]);
    const result = await new Promise<unknown>((resolve) => {
      const sync = plugin.highlight(
        { code: "const a = 1;", language: "ts" as never, themes: ["one-light", "dracula"] as never },
        resolve as never,
      );
      if (sync) resolve(sync);
    });
    const tokens = (result as { tokens: Tokenish[][]; rootStyle?: string }).tokens;
    const flat = tokens.flat();
    expect(flat.length).toBeGreaterThan(2);
    // defaultColor=light：浅主题落在 htmlStyle.color，深主题落在 --shiki-dark 变量
    expect(flat.some((token) => typeof token.htmlStyle?.color === "string")).toBe(true);
    expect(flat.some((token) => token.htmlStyle?.["--shiki-dark"] !== undefined)).toBe(true);
    // 主题底色经 rootStyle 变量对下发（浅槽 + 深槽 --shiki-dark-bg）
    const rootStyle = (result as { rootStyle?: string }).rootStyle ?? "";
    expect(rootStyle).toContain("--sdm-bg");
    expect(rootStyle).toContain("--shiki-dark-bg");
    // 回归锚：禁止内联 background-color/color——内联样式压过容器深色主题
    // 切换规则，暗色下代码块会停留在浅色白底。
    expect(rootStyle).not.toMatch(/color:/);
  }, 30000);

  it("未知语言回落 text，不抛错", async () => {
    const plugin = createShikiCodePlugin("github-light", "github-dark");
    const result = await new Promise<unknown>((resolve) => {
      const sync = plugin.highlight(
        { code: "hello", language: "no-such-lang" as never, themes: ["github-light", "github-dark"] as never },
        resolve as never,
      );
      if (sync) resolve(sync);
    });
    expect((result as { tokens: Tokenish[][] }).tokens.flat().length).toBeGreaterThan(0);
  }, 30000);
});
