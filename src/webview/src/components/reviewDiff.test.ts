import { describe, expect, it } from "vitest";
import { parseUnifiedPatch } from "./reviewDiff";

const PATCH = [
  "diff --git a/a.ts b/a.ts",
  "index 1111111..2222222 100644",
  "--- a/a.ts",
  "+++ b/a.ts",
  "@@ -1,3 +1,3 @@",
  " keep",
  "-old line",
  "+new line",
  " tail",
  "@@ -10,2 +10,3 @@",
  " ctx",
  "+added",
  " end",
  "",
].join("\n");

describe("parseUnifiedPatch", () => {
  it("空串/非法文本 → 空 hunk 列表", () => {
    expect(parseUnifiedPatch("")).toEqual([]);
    expect(parseUnifiedPatch("not a patch")).toEqual([]);
  });

  it("hunk 行转双列行号（del 带旧号、add 带新号、context 双号）", () => {
    const hunks = parseUnifiedPatch(PATCH);
    expect(hunks).toHaveLength(2);
    expect(hunks[0]!.header).toBe("@@ -1,3 +1,3 @@");
    expect(hunks[0]!.rows).toEqual([
      { type: "context", oldNo: 1, newNo: 1, text: "keep" },
      { type: "del", oldNo: 2, newNo: null, text: "old line" },
      { type: "add", oldNo: null, newNo: 2, text: "new line" },
      { type: "context", oldNo: 3, newNo: 3, text: "tail" },
    ]);
    // 第二个 hunk 行号独立起算
    expect(hunks[1]!.rows[1]).toEqual({ type: "add", oldNo: null, newNo: 11, text: "added" });
  });
});
