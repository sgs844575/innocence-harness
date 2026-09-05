// 输入卡补全纯逻辑：token 检测矩阵（slash 仅消息首词——与运行时 /^\/name\s*/
// 展开语义对齐；at 任意位置的当前词）、过滤排序规则、采纳替换与光标。
import { describe, expect, it } from "vitest";
import { applySuggestion, detectSuggestToken, filterFileItems, filterSkillItems, SUGGEST_MAX_ROWS } from "./suggest";

describe("detectSuggestToken", () => {
  it("slash：消息首词内触发，query 不含前导符", () => {
    expect(detectSuggestToken("/deb", 4)).toEqual({ kind: "slash", start: 0, end: 4, query: "deb" });
  });

  it("slash：允许前导空白（运行时对 text.trim() 匹配）", () => {
    expect(detectSuggestToken("  /rev", 6)).toEqual({ kind: "slash", start: 2, end: 6, query: "rev" });
  });

  it("slash：越过空白（完形）后不再触发", () => {
    expect(detectSuggestToken("/debugging 修一下", 14)).toBeNull();
  });

  it("slash：不在消息开头（运行时不展开）不触发", () => {
    expect(detectSuggestToken("看下 /debugging", 12)).toBeNull();
  });

  it("slash：光标在 / 之前不触发", () => {
    expect(detectSuggestToken("/abc", 0)).toBeNull();
  });

  it("at：任意位置当前词以 @ 起头即触发", () => {
    expect(detectSuggestToken("看一下 @src/ap", 11)).toEqual({ kind: "at", start: 4, end: 11, query: "src/ap" });
  });

  it("at：词中含路径分隔符仍是同一 token", () => {
    expect(detectSuggestToken("@a/b.ts", 7)).toEqual({ kind: "at", start: 0, end: 7, query: "a/b.ts" });
  });

  it("at：a@b 词首不是 @ 不触发", () => {
    expect(detectSuggestToken("mail a@b.com", 9)).toBeNull();
  });

  it("at：光标落在 @ 前不触发；@ 后立即触发", () => {
    expect(detectSuggestToken("x @y", 2)).toBeNull();
    expect(detectSuggestToken("@", 1)).toEqual({ kind: "at", start: 0, end: 1, query: "" });
  });

  it("无前导符返回 null", () => {
    expect(detectSuggestToken("普通文本", 4)).toBeNull();
    expect(detectSuggestToken("", 0)).toBeNull();
  });
});

describe("filterSkillItems", () => {
  const catalog = [
    { name: "debugging", description: "systematic bug hunting" },
    { name: "code-review", description: "review a diff" },
    { name: "verify", description: "verify before done — debugging mindset" },
  ];

  it("空 query 全量返回", () => {
    expect(filterSkillItems(catalog, "")).toHaveLength(3);
  });

  it("名前缀 > 名包含 > 描述包含", () => {
    const ranked = filterSkillItems(catalog, "deb");
    expect(ranked.map((skill) => skill.name)).toEqual(["debugging", "verify"]);
  });

  it("描述匹配兜底可发现", () => {
    const ranked = filterSkillItems(catalog, "diff");
    expect(ranked.map((skill) => skill.name)).toEqual(["code-review"]);
  });

  it("无匹配返回空", () => {
    expect(filterSkillItems(catalog, "zzz")).toEqual([]);
  });

  it("渲染封顶 SUGGEST_MAX_ROWS", () => {
    const many = Array.from({ length: SUGGEST_MAX_ROWS + 30 }, (_, i) => ({ name: `s${i}`, description: "" }));
    expect(filterSkillItems(many, "")).toHaveLength(SUGGEST_MAX_ROWS);
  });
});

describe("filterFileItems", () => {
  const paths = [
    "src/app/main.ts",
    "src/app/utils.ts",
    "docs/main.md",
    "README.md",
  ];

  it("文件名前缀 > 文件名包含 > 路径包含，平局短路径优先", () => {
    const ranked = filterFileItems(paths, "main");
    expect(ranked.map((file) => file.path)).toEqual(["docs/main.md", "src/app/main.ts"]);
    expect(ranked[0]).toMatchObject({ name: "main.md", dir: "docs/" });
    expect(ranked[1]).toMatchObject({ name: "main.ts", dir: "src/app/" });
  });

  it("路径段匹配（目录名）可发现", () => {
    const ranked = filterFileItems(paths, "utils");
    expect(ranked.map((file) => file.path)).toEqual(["src/app/utils.ts"]);
  });

  it("无匹配返回空", () => {
    expect(filterFileItems(paths, "nothing")).toEqual([]);
  });
});

describe("applySuggestion", () => {
  it("slash 采纳：整个 /词 替换为 /name 加尾空格，光标落末尾", () => {
    const token = detectSuggestToken("/deb", 4)!;
    const next = applySuggestion("/deb", token, "/debugging ");
    expect(next).toEqual({ value: "/debugging ", caret: 11 });
  });

  it("at 采纳：@词 替换为 @path 加尾空格，保留词后文本", () => {
    const token = detectSuggestToken("看 @src/ap 再说", 9)!;
    expect(token).toEqual({ kind: "at", start: 2, end: 9, query: "src/ap" });
    const next = applySuggestion("看 @src/ap 再说", token, "@src/app/main.ts ");
    expect(next).toEqual({ value: "看 @src/app/main.ts  再说", caret: 19 });
  });
});
