import { describe, expect, it } from "vitest";
import { normalizeUrl } from "./browserUrl";

describe("normalizeUrl", () => {
  it("空输入与纯空白 → null", () => {
    expect(normalizeUrl("")).toBeNull();
    expect(normalizeUrl("   ")).toBeNull();
  });

  it("缺协议补 https://", () => {
    expect(normalizeUrl("baidu.com")).toBe("https://baidu.com/");
    expect(normalizeUrl("example.com/path?q=1")).toBe("https://example.com/path?q=1");
  });

  it("已有 http/https 协议原样保留", () => {
    expect(normalizeUrl("http://localhost:5173")).toBe("http://localhost:5173/");
    expect(normalizeUrl("https://example.com/a b".replace(" ", "%20"))).toContain("https://example.com/");
  });

  it("非 http(s) 协议拒绝（file/javascript/about）", () => {
    expect(normalizeUrl("file:///etc/passwd")).toBeNull();
    expect(normalizeUrl("javascript:alert(1)")).toBeNull();
    expect(normalizeUrl("about:blank")).toBeNull();
  });
});
