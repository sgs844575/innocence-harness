// S1 后台会话运行器：状态行协议提取器（源件 background-job-agent 状态信号
// 语义的确定性改编——协议行是唯一完成信号，散文不检出；错误旗标优先）。
export type BackgroundJobStatus = "working" | "done" | "blocked" | "failed";

export interface BackgroundJobOutcome {
  status: Exclude<BackgroundJobStatus, "working">;
  /** 状态行后的一行自含标题（无状态行的降级路径取首条非空行）。 */
  headline: string;
}

/** 协议标记（独立行锚定）：最后一个标记行胜出。 */
const STATUS_MARKERS: ReadonlyArray<{ marker: string; status: BackgroundJobOutcome["status"] }> = [
  { marker: "result:", status: "done" },
  { marker: "needs input:", status: "blocked" },
  { marker: "failed:", status: "failed" },
];

function firstNonEmptyLine(lines: readonly string[]): string {
  for (const line of lines) {
    const trimmed = line.trim();
    // 裸标记行不作降级标题（协议残留不是内容）。
    if (trimmed.length > 0 && !STATUS_MARKERS.some((m) => trimmed === m.marker)) return trimmed;
  }
  return "";
}

function lastNonEmptyIndex(lines: readonly string[]): number {
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (lines[i]!.trim().length > 0) return i;
  }
  return -1;
}

/**
 * 从回复文本提取状态行结局；标记行必须是末条非空行（信封约定"at the very
 * end"，代码块/引用里的行天然不满足），否则返回 undefined（调用方决定降级
 * 口径）。标题取标记行余文（裸标记 = 空标题，通知面回落到状态标题）。
 */
export function extractBackgroundOutcome(replyText: string): BackgroundJobOutcome | undefined {
  const lines = replyText.split("\n");
  const last = lastNonEmptyIndex(lines);
  if (last < 0) return undefined;
  const trimmed = lines[last]!.trim();
  for (const { marker, status } of STATUS_MARKERS) {
    if (trimmed === marker || trimmed.startsWith(marker + " ")) {
      return { status, headline: trimmed.slice(marker.length).trim() };
    }
  }
  return undefined;
}

/**
 * 一次后台作业运行的终态：错误旗标优先（失败回合即使镜像了告警文本也判
 * 失败）；无状态行且无错误 = 降级 done（信封强约束协议；降级标题取首条
 * 非空行，空回复取空标题——通知面照实呈现）。
 */
export function backgroundOutcomeOf(replyText: string, errored: boolean): BackgroundJobOutcome {
  if (errored) return { status: "failed", headline: firstNonEmptyLine(replyText.split("\n")) };
  return extractBackgroundOutcome(replyText) ?? {
    status: "done",
    headline: firstNonEmptyLine(replyText.split("\n")),
  };
}
