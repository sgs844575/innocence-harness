import { describe, expect, it } from "vitest";
import {
  DARK_CODE_THEMES,
  DEFAULT_CODE_THEME_DARK,
  DEFAULT_CODE_THEME_LIGHT,
  LIGHT_CODE_THEMES,
} from "../../../shared/codeThemes";
import { createShikiCodePlugin } from "./shikiPlugin";

interface Tokenish {
  content: string;
  color?: string;
  htmlStyle?: Record<string, string>;
}

async function highlight(
  light: string,
  dark: string,
  language = "ts",
): Promise<{ tokens: Tokenish[][]; rootStyle?: string }> {
  const plugin = createShikiCodePlugin(light, dark);
  return new Promise((resolve) => {
    const sync = plugin.highlight(
      { code: "const a = 1;", language: language as never, themes: [light, dark] as never },
      resolve as never,
    );
    if (sync) resolve(sync as never);
  });
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
    const plugin = createShikiCodePlugin("github-light-default", "github-dark-default");
    const result = await new Promise<unknown>((resolve) => {
      const sync = plugin.highlight(
        {
          code: "hello",
          language: "no-such-lang" as never,
          themes: ["github-light-default", "github-dark-default"] as never,
        },
        resolve as never,
      );
      if (sync) resolve(sync);
    });
    expect((result as { tokens: Tokenish[][] }).tokens.flat().length).toBeGreaterThan(0);
  }, 30000);

  it("设置页列出的每个主题都能加载并提供自己的背景槽", async () => {
    for (const light of LIGHT_CODE_THEMES) {
      const result = await highlight(light, DEFAULT_CODE_THEME_DARK);
      expect(result.rootStyle, light).toContain("--sdm-bg:");
      expect(result.tokens.flat().length, light).toBeGreaterThan(2);
    }
    for (const dark of DARK_CODE_THEMES) {
      const result = await highlight(DEFAULT_CODE_THEME_LIGHT, dark);
      expect(result.rootStyle, dark).toContain("--shiki-dark-bg:");
      expect(result.tokens.flat().length, dark).toBeGreaterThan(2);
    }
  }, 60000);
});
