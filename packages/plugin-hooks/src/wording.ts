// Hook wiring wording (batch 4C task 2): every string the hooks plugin puts
// in front of the model lives in this one module — the audit surface for
// the text discipline. The shapes adapt the reference project's hook
// reminder semantics (additional context from a hook, a blocking refusal,
// a stopped-continuation follow-up) as restructured English rewrites: hook
// output is additional context inside a system-reminder envelope, never a
// user instruction; a pre-tool refusal names the command, the exit status
// and the bounded detail; failures degrade to short warning lines.
// The stop-face section (batch 5) is deliberately outside that envelope
// discipline: the session is over when it fires, so its lines are host log
// copy only — command output is summarized to the log and never injected
// anywhere.
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
  if (result.aborted) {
    return `hook "${hook.command}" was aborted before it finished`;
  }
  const detail = result.output.trim();
  return detail.length > 0
    ? `hook "${hook.command}" failed: ${detail}`
    : `hook "${hook.command}" failed without output`;
}

/**
 * One permission-gate skip as a single warning line: the command was never
 * executed — the user (or the missing authorization surface itself)
 * declined it. Distinct from an execution failure: there is nothing to
 * fail because nothing ran.
 */
export function formatPermissionSkip(hook: HookDefinition, reason: string): string {
  const detail = reason.trim();
  return detail.length > 0
    ? `hook "${hook.command}" was not run: the permission gate declined it (${detail})`
    : `hook "${hook.command}" was not run: the permission gate declined it`;
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

// ---------------------------------------------------------------------------
// Stop face (batch 5): the sessionStop event has no conversation left to
// address — the session is being torn down, command output is discarded
// rather than injected, and every line below is host LOG copy, never a
// model-facing block. The budget for one excerpt of a finished stop
// command's output.
const STOP_LOG_EXCERPT_CHARS = 200;

/** Collapses one output excerpt to a single bounded log-friendly line. */
function stopExcerpt(output: string): string {
  const flat = output.trim().replace(/\s+/g, " ");
  if (flat.length <= STOP_LOG_EXCERPT_CHARS) return flat;
  return `${flat.slice(0, STOP_LOG_EXCERPT_CHARS)}...`;
}

/**
 * Info line for one finished stop command: names the command and carries a
 * flattened excerpt of its output so operators can see what a teardown
 * sweep printed without the conversation ever receiving it.
 */
export function formatStopHookSummary(command: string, output: string): string {
  const excerpt = stopExcerpt(output);
  return excerpt.length > 0
    ? `stop command "${command}" completed; output excerpt: ${excerpt}`
    : `stop command "${command}" completed without output`;
}

/**
 * Warn line for one stop command that did not finish cleanly. A non-zero
 * exit names the status (an explicit refusal has no conversation to block,
 * so it is only reported); a deadline kill or spawn failure names that
 * instead. Teardown is never delayed or failed by any of these.
 */
export function formatStopHookFailure(command: string, result: HookRunResult): string {
  if (result.timedOut) {
    return `stop command "${command}" was killed at its deadline`;
  }
  if (result.aborted) {
    return `stop command "${command}" was aborted mid-run`;
  }
  const excerpt = stopExcerpt(result.output);
  if (typeof result.exitCode === "number") {
    return excerpt.length > 0
      ? `stop command "${command}" exited ${result.exitCode}: ${excerpt}`
      : `stop command "${command}" exited ${result.exitCode} without output`;
  }
  return excerpt.length > 0
    ? `stop command "${command}" could not start: ${excerpt}`
    : `stop command "${command}" could not start`;
}

/**
 * Warn line when the teardown wait gave up while stop commands were still
 * pending: session release continues, the detached commands keep running
 * under their own per-command deadlines, and whatever they print is lost.
 */
export function formatStopWaitReleased(waitMs: number): string {
  return `session teardown waited ${waitMs}ms for stop commands and moved on; any still-pending commands continue detached`;
}

/**
 * Info line when the whole stop face is bypassed because the host is on
 * its quit path: no teardown commands are started for a shutdown, so the
 * exiting process never spawns fresh children.
 */
export function formatStopSkippedForShutdown(): string {
  return "stop commands were bypassed because the host is shutting down";
}
