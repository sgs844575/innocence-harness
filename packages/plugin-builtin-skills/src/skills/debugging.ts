import { defineSkill } from "../define";

/**
 * Debugging discipline (adapted from the reference project's debug skill):
 * four ordered gates — reproduce, locate the root cause, repair, confirm —
 * with trial edits banned before the causal chain is established.
 */
export const debuggingSkill = defineSkill(
  "debugging",
  "Systematic defect resolution: reproduce, isolate the root cause, repair, then prove the trigger path is gone",
  `# Debugging discipline

Resolve defects through four gates in strict order. Do not skip ahead: each gate produces the evidence the next one needs.

## Gate 1 - Reproduce

Turn the report into a stable trigger path: an exact sequence of steps, inputs, state, and environment that makes the failure appear on demand.

- When a failure appears only sometimes, vary one factor at a time — input size, timing, platform, prior state — until the trigger turns deterministic or the deciding factor is named.
- No reproduction means no fix. A repair aimed at a failure you cannot trigger is a guess, and you will be unable to prove it worked.

## Gate 2 - Locate the root cause

Treat symptoms as clues, never as conclusions. The visible error marks where the system complained, which is frequently downstream of where the trouble began.

- Read the raw stack trace and the error text word for word; look up unfamiliar codes instead of assuming their meaning.
- Add the smallest observation possible at the suspected boundary — one log line, one assertion, one breakpoint — instead of instrumenting broadly.
- Bisect when unsure which layer fails: split the path in half, test which half misbehaves, repeat until a single component is implicated.
- State the causal chain explicitly: "X is null because Y skipped initialization, which happens when Z runs first". Any link still marked "probably" means the cause is not located yet.

Never apply speculative edits at this stage. Random mutations consume the evidence already gathered and can mask the real defect.

## Gate 3 - Repair

Change exactly what the causal chain identified. Prefer removing the cause over absorbing its symptom at a distant call site. While editing, note nearby code sharing the same flaw for a follow-up.

## Gate 4 - Confirm the fix

Run the exact trigger path from Gate 1 and watch the failure disappear. Then examine the neighborhood:

- Repeat the trigger several times; intermittent causes demand repetition.
- Exercise adjacent paths to catch regressions the repair introduced.
- Mentally revert the patch: does the failure return for the reasons the chain predicted? If not, the explanation was wrong even though the symptom faded — reopen the investigation.`,
);
