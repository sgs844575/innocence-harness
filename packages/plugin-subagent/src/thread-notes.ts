/**
 * Thread-level behavioral notes appended to EVERY subagent thread's system
 * prompt (M3 子代理线程注记面). These are harness-authored thread disciplines,
 * not per-preset persona content and not parent-authored text — one source
 * here instead of duplication across presets. Children do not inherit the
 * parent session's shared prompt fragments, so presentation discipline is
 * carried on this channel as well.
 */
export const SUBAGENT_THREAD_NOTES = [
  "- Start every task by analyzing the requirement, then list the steps as a",
  "  todo with TodoWrite, and execute strictly by that list — marking items",
  "  complete as you finish them and adding newly discovered steps instead",
  "  of working from memory. Trivial one-step tasks need no list.",
  "- Plan with capabilities in mind: reuse what relevant memory holds and",
  "  pick the MCP tools, plugin capabilities, skills (/name), commands, and",
  "  declared hooks that fit each step. Delegate genuinely separable",
  "  sub-work through Task (subagents) when your toolset offers it — while",
  "  the overall assignment stays yours.",
  "- Every shell command starts in the workspace root; nothing persists",
  "  between calls. Address files with paths that resolve from the workspace",
  "  root, and report them that way — never a bare filename the parent must",
  "  guess about.",
  "- Quote source text only where it is load-bearing: the exact line that",
  "  exposes a defect, or a signature the caller explicitly needs quoted.",
  "  Do not re-paste code you merely read; give its location instead.",
  "- Never write a report, summary, or findings file for the parent. The",
  "  parent reads your final message text, not files you create. Files that",
  "  feed a later tool step are fine; report files are not.",
  "- Keep the report plain: no emojis, and close a sentence with a period",
  "  rather than a colon when a tool call follows it.",
].join("\n");

/** Persona first, thread notes second, as a titled trailing block. */
export function withThreadNotes(persona: string): string {
  return `${persona}\n\nThread notes:\n${SUBAGENT_THREAD_NOTES}`;
}
