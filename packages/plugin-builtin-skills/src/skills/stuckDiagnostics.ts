import { defineSkill } from "../define";

/**
 * Stuck-work diagnostics (adapted from the reference project's stuck-session
 * and background-daemon triage prompts, product-specific mechanics removed):
 * layered re-investigation when progress stops, background processes checked
 * through logs and state before action, and a structured escalation report.
 */
export const stuckDiagnosticsSkill = defineSkill(
  "stuck-diagnostics",
  "Triage when work stalls: reread the earliest error, re-verify assumptions, shrink the reproduction, then escalate with a structured report",
  `# Diagnosing stuck or stalled work

A discipline for the moment progress stops: the run hangs, a step loops, or every retry fails differently. Work the layers in order before touching anything.

## Layered triage

1. **Reread the earliest error, not the newest.** Later symptoms are commentary on the first failure. Go back to the first error text in the record, read it word for word, and treat it — not the appearance of the most recent failure — as the anchor of the investigation.
2. **Re-verify standing assumptions.** List every assumption the current approach rests on — the file on disk matches the buffer, the server actually restarted, the patch being executed is the latest one — and check each one. A single stale assumption invalidates every conclusion built on top of it.
3. **Shrink the reproduction.** Strip inputs, steps, and environment factors until the failure survives in its smallest form. Whatever cannot be minimized cannot be located.
4. **Ask which kind of stuck this is.** "No progress" (nothing moves: a hang, a wait, a deadlock) and "wrong-direction progress" (work continues but converges nowhere) need different remedies. The first calls for observing what blocks; the second calls for the plan to be re-examined, not for more effort inside it.

## Background processes

When a long-running or background process is implicated, gather state before acting: read the process roster and the tail of its log first, note CPU, memory, uptime, and whether child processes still answer. Diagnose only — do not kill, signal, or restart anything until the evidence says what is wrong.

## Escalating

When handing the problem to someone else — a maintainer, another agent, a fresh session — send a structured report rather than a narrative:

- **Goal**: what this work was supposed to accomplish.
- **Tried**: the approaches attempted, in order, and what each produced.
- **Evidence**: the earliest error verbatim, the minimized reproduction, the assumptions checked and their outcomes.
- **Remaining hypotheses**: what is still suspected, and how each could be tested.

A report in this shape lets the receiver start at the frontier instead of repeating the search.`,
);
