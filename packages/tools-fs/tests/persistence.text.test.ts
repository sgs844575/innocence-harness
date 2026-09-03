// 持久化正文契约（用户裁定：Edit/Write 的正文进入 persisted args，供聊天
// 工具行展示“改了什么”；不再脱敏为仅有 hash）。护栏锁定三件事：
//  1. persistArgs 保留正文（封顶以防巨型内容失控）；
//  2. 摘要与正文一致（逗号分隔行 → 计数一致）；
//  3. 超大内容被 boundedText 截到封顶，并带省略号标记。
import { describe, expect, it } from "vitest";
import { boundPersistedText } from "../src/persisted-text";
import { editTool } from "../src/edit";
import { writeTool } from "../src/write";

describe("Edit/Write persisted args keep the real text (no redaction to hash-only)", () => {
  it("Write persisted args carry the content body verbatim", () => {
    const persisted = writeTool.persistArgs({
      path: "src/a.ts",
      content: `export const n = 1;\n`,
    });
    expect(persisted).toMatchObject({
      path: "src/a.ts",
      content: `export const n = 1;\n`,
      contentLength: `export const n = 1;\n`.length,
    });
    expect(persisted).not.toHaveProperty("contentSha256");
  });

  it("Edit persisted args carry old/new strings verbatim", () => {
    const persisted = editTool.persistArgs({
      path: "src/a.ts",
      old_string: "const a = 1;",
      new_string: "const a = 2;\nconst b = 3;",
    });
    expect(persisted).toMatchObject({
      path: "src/a.ts",
      old_string: "const a = 1;",
      new_string: "const a = 2;\nconst b = 3;",
    });
    expect(persisted).not.toHaveProperty("contentSha256");
  });

  it("both keep a real-text summary alongside the (capped) body", () => {
    const writePersisted = writeTool.persistArgs({
      path: "src/a.ts",
      content: "l1\nl2\nl3",
    });
    expect(writePersisted).toMatchObject({ summary: "l1 | l2 | l3" });

    const editPersisted = editTool.persistArgs({
      path: "src/a.ts",
      old_string: "l0",
      new_string: "l1\nl2\nl3",
    });
    expect(editPersisted).toMatchObject({ summary: "l1 | l2 | l3" });
  });

  it("giant content is capped instead of persisted in full", () => {
    const giant = "x".repeat(200_000);
    const persisted = writeTool.persistArgs({ path: "src/big.ts", content: giant });
    const body = String(persisted.content);
    expect(body.length).toBeLessThan(100_000);
    expect(String(persisted.summary).length ?? 0).toBeLessThanOrEqual(500);
    expect(String(persisted.summary)).toBe("…");
  });
});

describe("boundPersistedText", () => {
  it("caps length and flags the truncation", () => {
    const text = "a".repeat(500);
    const bound = boundPersistedText(text, 100);
    expect(bound.text.length).toBeLessThanOrEqual(100);
    expect(bound.text.endsWith("…")).toBe(true);
    expect(bound.truncated).toBe(true);
  });

  it("keeps short text intact without a marker", () => {
    const bound = boundPersistedText("hello", 100);
    expect(bound.text).toBe("hello");
    expect(bound.truncated).toBe(false);
  });
});