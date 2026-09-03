// 审查面板的 diff 视图模型：git unified diff 文本 → 带双列行号的行序列
//（context/del/add）。解析用已装依赖 diff 的 parsePatch（不手写 patch 解析）。
import { parsePatch } from "diff";

export interface ReviewDiffRow {
  type: "context" | "del" | "add";
  /** 旧/新侧行号（不适用侧为 null）。 */
  oldNo: number | null;
  newNo: number | null;
  text: string;
}

export interface ReviewDiffHunk {
  /** @@ -a,b +c,d @@ 节标题（hunk 间分隔展示）。 */
  header: string;
  rows: ReviewDiffRow[];
}

/** 解析单文件 unified patch 为行号 hunk 序列；空/非法 patch → 空数组。 */
export function parseUnifiedPatch(patch: string): ReviewDiffHunk[] {
  if (patch.trim() === "") return [];
  let files: ReturnType<typeof parsePatch>;
  try {
    files = parsePatch(patch);
  } catch {
    return [];
  }
  const hunks: ReviewDiffHunk[] = [];
  for (const file of files) {
    for (const hunk of file.hunks) {
      const rows: ReviewDiffRow[] = [];
      let oldNo = hunk.oldStart;
      let newNo = hunk.newStart;
      for (const line of hunk.lines) {
        const marker = line[0];
        const text = line.slice(1);
        if (marker === "-") rows.push({ type: "del", oldNo: oldNo++, newNo: null, text });
        else if (marker === "+") rows.push({ type: "add", oldNo: null, newNo: newNo++, text });
        else if (marker === "\\") continue; // "\ No newline at end of file" 标记行不渲染
        else rows.push({ type: "context", oldNo: oldNo++, newNo: newNo++, text });
      }
      hunks.push({ header: `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`, rows });
    }
  }
  return hunks;
}
