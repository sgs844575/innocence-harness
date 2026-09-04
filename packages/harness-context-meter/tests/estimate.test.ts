import { describe, expect, it } from "vitest";
import { estimateTokens } from "../src/estimate";

describe("estimateTokens", () => {
  it("纯 ASCII 约 4 字符/token，向上取整", () => {
    expect(estimateTokens("abcdefgh")).toBe(2); // 8/4
    expect(estimateTokens("abc")).toBe(1); // ceil(0.75)
  });

  it("纯 CJK 约 1 token/字", () => {
    expect(estimateTokens("上下文容量")).toBe(5);
  });

  it("混合按码点分类累计", () => {
    // 4 ASCII(=1) + 2 CJK(=2) → 3
    expect(estimateTokens("abcd上下")).toBe(3);
  });

  it("空串为 0", () => {
    expect(estimateTokens("")).toBe(0);
  });
});
