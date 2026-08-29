// Hook wiring wording (batch 4C task 2): every string the hooks plugin puts
// in front of the model lives in this one module — the audit surface for
// the text discipline. The shapes adapt the reference project's hook
// reminder semantics (additional context from a hook, a blocking refusal,
// a stopped-continuation follow-up) as restructured English rewrites: hook
// output is additional context inside a system-reminder envelope, never a
// user instruction; a pre-tool refusal names the command, the exit status
// and the bounded detail; failures degrade to short warning lines.
import type { HookDefinition } from "./config";
import type { HookRunResult } from "./runner";

/** Wraps one rendered body in the shared reminder envelope. */
function reminderEnvelope(body: string): string {
  return `<system-reminder>\n${body}\n</system-reminder>`;
}

/**
 * The session-start block: one envelope over every hook's output, with
 * configuration parse warnings (and any failed start hook) as trailing
 * warning lines. Undefined when there is nothing to say — no hooks, no
 * output and no warnings means no block.
 */
export function renderSessionStartReminder(
  outputs: readonly string[],
  warnings: readonly string[],
): string | undefined {
  const lines: string[] = ["[hook context (session start)]"];
  for (const output of outputs) lines.push(output.trimEnd());
  for (const warning of warnings) lines.push(`[hook warning] ${warning}`);
  if (lines.length === 1) return undefined;
  return reminderEnvelope(lines.join("\n"));
}

/** One hook's non-empty output becomes its own context envelope. */
export function renderPromptContextReminder(output: string): string {
  return reminderEnvelope(`[hook context]\n${output.trimEnd()}`);
}

/** Warning lines (deferred failures, parse problems) share one envelope. */
export function renderWarningReminder(lines: readonly string[]): string {
  return reminderEnvelope(["[hook warning]", ...lines].join("\n"));
}

/**
 * One failure as a single line: names the command plus the bounded detail.
 * The runner already caps output at 8KB, so the line can never carry an
 * oversized dump; a timeout names itself because its output is usually
 * empty.
 */
export function formatHookFailure(hook: HookDefinition, result: HookRunResult): string {
  if (result.timedOut) {
    return `hook "${hook.command}" timed out and contributed nothing`;
  }
  const detail = result.output.trim();
  return detail.length > 0
    ? `hook "${hook.command}" failed: ${detail}`
    : `hook "${hook.command}" failed without output`;
}

/**
 * Content of the denied tool result — the only interception surface. Names
 * the hook command, the explicit exit status and the bounded stderr/output
 * detail, then states the rule: the model adjusts its approach, the hook
 * decides what passes.
 */
export function renderHookVetoContent(command: string, exitCode: number, detail: string): string {
  const lines = [
    "[hook veto]",
    "A pre-tool hook stopped this tool call.",
    `command: ${command}`,
    `exit code: ${exitCode}`,
  ];
  const trimmed = detail.trim();
  if (trimmed.length > 0) lines.push(`detail: ${trimmed}`);
  lines.push(
    "Adjust the approach and pick a route the hook permits; the hook is the gate, so repeating the identical call will be refused again.",
  );
  return lines.join("\n");
}

/**
 * The one-time follow-up injected on the next user turn after a veto: the
 * previous round's refusal stands as session policy, so the conversation
 * continues on an adjusted path instead of retrying the stopped call.
 */
export function renderContinuationReminder(
  toolName: string,
  command: string,
  exitCode: number,
): string {
  return reminderEnvelope(
    [
      "[hook follow-up]",
      `The previous round had its "${toolName}" call stopped by the pre-tool hook "${command}" (exit ${exitCode}).`,
      "That refusal stands as session policy: continue with an adjusted approach instead of repeating the stopped call.",
    ].join("\n"),
  );
}

/** Appends one hook note at the tail of a tool result's content. */
export function appendHookNote(content: string, output: string): string {
  const note = `[hook note]\n${output.trimEnd()}`;
  return content.length > 0 ? `${content}\n${note}` : note;
}
