// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { hasFileIcon, resolveFileIcon } from "./fileIcons";
import { hasBrandIcon, resolveBrandIcon } from "./brandIcons";

describe("resolveFileIcon", () => {
  it("maps source files by extension", () => {
    expect(resolveFileIcon("src/main/harnessGlue.ts")?.length ?? 0).toBeGreaterThan(0);
    expect(resolveFileIcon("components/App.tsx")).not.toBeNull();
    expect(resolveFileIcon("logo.svg")).not.toBeNull();
  });

  it("maps well-known exact filenames", () => {
    expect(resolveFileIcon("packages/harness-diagnostics/tsconfig.json")).not.toBeNull();
    expect(resolveFileIcon("package.json")).not.toBeNull();
    expect(resolveFileIcon(".gitignore")).not.toBeNull();
  });

  it("returns null for unknown files so callers fall back to a generic glyph", () => {
    expect(resolveFileIcon("data.unknownext")).toBeNull();
    expect(resolveFileIcon("")).toBeNull();
  });

  it("prefers _light variants in light theme when present", () => {
    const dark = resolveFileIcon("src/x.ts", false);
    const light = resolveFileIcon("src/x.ts", true);
    expect(dark).not.toBeNull();
    expect(light).not.toBeNull();
    // 绝大多数图标没有 _light 变体——两者等价即合法；有变体时必不相等。
    if (hasFileIcon("typescript_light")) expect(light).not.toBe(dark);
    else expect(light).toBe(dark);
  });
});

describe("resolveBrandIcon", () => {
  it("matches provider and model keywords", () => {
    expect(resolveBrandIcon("openai")).not.toBeNull();
    expect(resolveBrandIcon("gpt-5.6-terra")).not.toBeNull();
    expect(resolveBrandIcon("anthropic/claude-4")).not.toBeNull();
    expect(resolveBrandIcon("deepseek-chat")).not.toBeNull();
    expect(resolveBrandIcon("glm-5")).not.toBeNull();
  });

  it("falls back to mono when no color variant exists, null when unknown", () => {
    expect(resolveBrandIcon("openai", true)).not.toBeNull(); // 无彩色版 → 单色
    expect(hasBrandIcon("claude-color")).toBe(true);
    expect(resolveBrandIcon("totally-unknown-vendor")).toBeNull();
  });
});
