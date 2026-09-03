import { describe, expect, it } from "vitest";
import { createOutputDecoder } from "../src/output-decoder";

const gbk = (text: string): Buffer => {
  // 经 TextEncoder 无法产出 GBK，用对照表构造：测试只用“测试”“不是内部或外部命令”。
  const map: Record<string, number[]> = {
    测试: [0xb2, 0xe2, 0xca, 0xd4],
    不是内部或外部命令: [
      0xb2, 0xbb, 0xca, 0xc7, 0xc4, 0xda, 0xb2, 0xbf, 0xbb, 0xf2, 0xcd, 0xe2, 0xb2, 0xbf, 0xc3, 0xfc, 0xc1, 0xee,
    ],
  };
  const bytes = map[text];
  if (!bytes) throw new Error(`no GBK fixture for: ${text}`);
  return Buffer.from(bytes);
};

describe("createOutputDecoder", () => {
  it("passes ASCII through without committing to an encoding", () => {
    const decoder = createOutputDecoder("gbk");
    expect(decoder.push(Buffer.from("hello world", "latin1"))).toBe("hello world");
    expect(decoder.end()).toBe("");
  });

  it("decodes UTF-8, including multibyte characters split across chunks", () => {
    const decoder = createOutputDecoder(null);
    const bytes = Buffer.from("中文测试", "utf8");
    expect(decoder.push(bytes.subarray(0, 1))).toBe("");
    expect(decoder.push(bytes.subarray(1, 4))).toBe("中");
    expect(decoder.push(bytes.subarray(4))).toBe("文测试");
    expect(decoder.end()).toBe("");
  });

  it("decodes localized console bytes with the given system codepage", () => {
    const decoder = createOutputDecoder("gbk");
    const text = decoder.push(Buffer.concat([Buffer.from("'wc' ", "latin1"), gbk("不是内部或外部命令")]));
    expect(text).toBe("'wc' 不是内部或外部命令");
    expect(decoder.end()).toBe("");
  });

  it("commits to UTF-8 when the bytes are valid UTF-8 even with a codepage fallback", () => {
    const decoder = createOutputDecoder("gbk");
    expect(decoder.push(Buffer.from("测试", "utf8"))).toBe("测试");
  });

  it("holds an ambiguous trailing lead byte until the next chunk disambiguates", () => {
    const decoder = createOutputDecoder("gbk");
    // 0xb2 单字节既像 UTF-8 序列头（此处为非法头）也像 GBK 头字节。
    expect(decoder.push(gbk("测试").subarray(0, 1))).toBe("");
    expect(decoder.push(gbk("测试").subarray(1))).toBe("测试");
  });

  it("keeps UTF-8 replacement behavior when no codepage fallback exists", () => {
    const decoder = createOutputDecoder(null);
    const text = decoder.push(gbk("测试"));
    expect(text).not.toBe("测试");
    expect([...text].some((ch) => ch.charCodeAt(0) === 0xfffd)).toBe(true);
  });

  it("flushes an incomplete tail on end without throwing", () => {
    const decoder = createOutputDecoder("gbk");
    // 0xe4 0xbd：合法 UTF-8 序列的不完整前缀，暂存 pending 直到流结束。
    expect(decoder.push(Buffer.from([0xe4, 0xbd]))).toBe("");
    expect(decoder.end().length).toBeGreaterThan(0);
  });

  it("flushes a truncated UTF-8 sequence to a replacement character", () => {
    const decoder = createOutputDecoder(null);
    expect(decoder.push(Buffer.from([0xe4, 0xbd]))).toBe("");
    expect(decoder.end().charCodeAt(0)).toBe(0xfffd);
  });
});
