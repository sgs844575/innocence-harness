// 字典完整性：zh/en 键集必须一致（缺键静默回落英文会造成半翻译 UI）。
import { describe, expect, it } from "vitest";
import { createT, enUS, zhCN } from "./i18n";

describe("i18n dictionaries", () => {
  it("zh/en 键集完全一致", () => {
    expect(Object.keys(enUS).sort()).toEqual(Object.keys(zhCN).sort());
  });

  it("英文副本不含中文", () => {
    const chinese = Object.entries(enUS).filter(([key, value]) => /[\u4e00-\u9fff]/.test(value) && !key.includes("prompt"));
    expect(chinese).toEqual([]);
  });

  it("产品名统一", () => {
    expect(createT("en-US")("app.name")).toBe("InnocenceHarness");
    expect(createT("zh-CN")("app.name")).toBe("InnocenceHarness");
  });
});
