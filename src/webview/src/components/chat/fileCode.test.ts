import { describe, expect, it } from "vitest";
import { codeFence, languageForFilePath, prepareFileContent } from "./fileCode";

describe("file code preparation", () => {
  it("infers a supported language from a file extension", () => {
    expect(languageForFilePath("src/config/package.json")).toBe("json");
    expect(languageForFilePath("src/view.tsx")).toBe("tsx");
    expect(languageForFilePath("src/unknown.data")).toBe("text");
  });

  it("removes read-result line prefixes and preserves a paged starting line", () => {
    expect(prepareFileContent('49\t"scripts": {\n50\t  "test": "vitest"\n[truncated]', true)).toEqual({
      code: '"scripts": {\n  "test": "vitest"',
      startLine: 49,
      note: "[truncated]",
      numbered: true,
    });
  });

  it("does not reinterpret ordinary file content as numbered transport output", () => {
    expect(prepareFileContent("const value = 1;", false)).toEqual({
      code: "const value = 1;",
      numbered: false,
    });
  });

  it("uses a fence longer than backticks contained in source", () => {
    const markdown = codeFence("const marker = ```;", "typescript", 7);
    expect(markdown).toMatch(/^````typescript startLine=7\n/);
    expect(markdown.endsWith("\n````")).toBe(true);
  });
});
