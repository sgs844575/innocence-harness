// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { applyFontScale } from "./fontScale";

afterEach(() => {
  document.documentElement.style.removeProperty("--font-size-ui");
  document.documentElement.style.removeProperty("--font-size-code");
});

describe("applyFontScale", () => {
  it("writes both size tokens onto the root element", () => {
    applyFontScale(16, 13);
    expect(document.documentElement.style.getPropertyValue("--font-size-ui")).toBe("16px");
    expect(document.documentElement.style.getPropertyValue("--font-size-code")).toBe("13px");
  });

  it("overwrites a previous value in place", () => {
    applyFontScale(16, 13);
    applyFontScale(14, 14);
    expect(document.documentElement.style.getPropertyValue("--font-size-ui")).toBe("14px");
    expect(document.documentElement.style.getPropertyValue("--font-size-code")).toBe("14px");
  });
});
