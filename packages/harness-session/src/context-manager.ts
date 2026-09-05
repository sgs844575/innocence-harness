import type { Provider } from "@innocenceharness/harness-providers";
import { isPlainText, toTranscript, type Message } from "./types";

export const SUMMARIZE_SYSTEM_PROMPT =
  "Summarize the conversation concisely, preserving task goals, decisions, " +
  "completed tool operations and key results, and unfinished work. " +
  "Return only the summary, without an introduction.";

/**
 * English disclosure appended to the compacted head message. Three semantics
 * carried together: the summary is a condensed account rather than the full
 * transcript (completeness), the turns past the split were kept verbatim
 * (partial-compaction boundary), and file references quoted from the
 * condensed portion may be stale and must be re-read before use.
 */
export const COMPACTION_DISCLOSURE =
  "Note: the earlier turns were condensed into this summary. It preserves " +
  "decisions and conclusions, but specific numbers, file states, and line " +
  "references may be stale; re-verify them against the files before relying " +
  "on them, and when quoting pre-compaction material, state that it comes " +
  "from the summary. Turns kept after the compaction boundary are verbatim " +
  "and unaffected.";

export interface CompactionOptions {
  /** Configured model window; absent retains the legacy threshold. */
  contextWindow?: number;
  /** Token estimate above this triggers compaction. Default 48000. */
  maxContextTokens: number;
  /** Recent messages always kept verbatim. Default 6. */
  keepRecent: number;
}

export const DEFAULT_COMPACTION: CompactionOptions = {
  maxContextTokens: 48_000,
  keepRecent: 6,
};

/** Rough token estimate (~4 chars per token) over the serialized message list. */
export function estimateTokens(messages: Message[]): number {
  return Math.ceil(JSON.stringify(messages).length / 4);
}

/**
 * Chooses the split index: everything before it may be compacted, the tail is
 * kept verbatim. The split must land on a plain user text message so that
 * toolCall/toolResult pairing is never broken. Returns 0 when no safe split
 * exists (history too short).
 */
export function findSplitIndex(messages: Message[], keepRecent: number): number {
  const maxSplit = messages.length - keepRecent;
  for (let i = maxSplit; i > 0; i--) {
    if (isPlainText(messages[i])) return i;
  }
  return 0;
}

export class ContextManager {
  readonly options: CompactionOptions;

  constructor(options: Partial<CompactionOptions> = {}) {
    this.options = { ...DEFAULT_COMPACTION, ...options };
  }

  private historyBudget(overheadTokens: number): number | undefined {
    const window = this.options.contextWindow;
    if (!window || !Number.isFinite(window) || window <= 0) return undefined;
    const reserve = Math.min(16_384, Math.ceil(window * 0.15));
    return Math.max(1, window - reserve - Math.max(0, overheadTokens));
  }

  needsCompaction(messages: Message[], overheadTokens = 0): boolean {
    const budget = this.historyBudget(overheadTokens);
    return estimateTokens(messages) > (budget === undefined ? this.options.maxContextTokens : budget * 0.8);
  }

  /**
   * Compacts history in place when over threshold. Returns true when a
   * compaction happened. When under threshold (or no safe split), no-op.
   */
  async maybeCompact(
    messages: Message[],
    provider: Provider,
    signal?: AbortSignal,
    overheadTokens = 0,
  ): Promise<boolean> {
    if (!this.needsCompaction(messages, overheadTokens)) return false;
    const budget = this.historyBudget(overheadTokens);
    let split = findSplitIndex(messages, this.options.keepRecent);
    if (budget !== undefined) {
      // Keep the largest safe suffix fitting the target, leaving summary room.
      // Hysteresis avoids repeatedly rewriting the cached history prefix.
      const target = budget * 0.5 - Math.min(4096, budget * 0.1);
      for (let i = 1; i <= split; i++) {
        if (isPlainText(messages[i]) && estimateTokens(messages.slice(i)) <= target) {
          split = i;
          break;
        }
      }
    }
    if (split <= 0) return false;

    const oldMessages = messages.slice(0, split);
    const transcript = toTranscript(oldMessages);
    let summary = "";
    for await (const delta of provider.chat({
      system: SUMMARIZE_SYSTEM_PROMPT,
      messages: [{ role: "user", parts: [{ type: "text", text: transcript }] }],
      tools: [],
      signal,
    })) {
      if (delta.type === "text") summary += delta.text;
    }
    if (!summary.trim()) return false;

    const summaryMessage: Message = {
      role: "user",
      parts: [
        {
          type: "text",
          text: `[此前对话已压缩为摘要]\n${summary}\n\n${COMPACTION_DISCLOSURE}`,
        },
      ],
    };
    const tail = messages.slice(split);
    if (budget !== undefined && estimateTokens([summaryMessage, ...tail]) >= estimateTokens(messages)) {
      return false;
    }
    messages.length = 0;
    messages.push(summaryMessage, ...tail);
    return true;
  }
}
