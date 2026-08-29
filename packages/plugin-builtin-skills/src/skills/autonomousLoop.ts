import { defineSkill } from "../define";

/**
 * Autonomous loop (adapted from the reference project's loop-command
 * family, its self-pacing and dynamic-pacing execution modes, the local
 * runtime note, and its recurring-cron scheduling flow; the cloud-scheduler
 * offer is trimmed — this harness schedules locally on plain intervals, and
 * calendar-style patterns are unsupported, which the body states honestly).
 */
export const autonomousLoopSkill = defineSkill(
  "autonomous-loop",
  "Run recurring work as a self-driving loop: set up the checklist and automation definition, pace by output between a floor and a ceiling, monitor progress, and end it on stated conditions",
  `# Autonomous loop

Turn recurring work into a checklist loop: an automation definition wakes
a target session on a cadence, and each wake advances one checklist file
until the work runs out.

## Set the loop up

- Put the checklist at \`.innocence/loop.md\` under the workspace root: a
  title line, then open items as a checkbox list. Size each item to one
  pass; a pass takes the first unticked entry, does that work, and marks it
  done in the file, so the file is the progress record an interrupted run
  resumes from.
- Create the automation through the app's automation configuration view:
  describe the recurring need, review the generated candidate, name it,
  and bind it to the target session. A loop payload on the definition
  points at the checklist file and may carry pacing bounds.
- Pick the starting interval from the work: minutes for short items,
  hours for longer ones. The first run can go out immediately instead of
  waiting a full interval.
- Settle the stop conditions before the first pass fires: all entries
  ticked, an error ceiling, or the user switching the definition off.
  Note the error ceiling in the checklist header.

## Let the pace follow the output

The dispatcher retunes the wait after every pass: a productive pass
tightens the cadence, an empty one stretches it, both clamped between a
floor and a ceiling. Reason the same way about the numbers you pick —
unbounded speed burns cost, unbounded patience floods the session with
noise, and a loop that keeps waking to find nothing new is pure spin.
After a failed pass, expect the next wake later, not sooner: that backoff
is the system cooling down, not a stall to fight.

## Watch it, then end it

Check in on your own period: list the definitions, open the checklist,
compare ticked entries against elapsed time. When a stop condition is met,
disable the definition. Completion handles itself once the last entry
lands; an error ceiling or a human decision needs a hand. Say what ended
the loop and what remains open.

## Scheduling semantics here

Scheduling here is interval-based: the schedule path fires every N
milliseconds, the idle path after the session stays quiet for a stretch.
This is not a full cron-style calendar engine. Express "every 20 minutes"
or "every two hours" as an interval; when asked for a weekday-and-time
pattern, say plainly it is not supported and offer the nearest interval
instead.

## The local bill

Every pass spends model quota and context in the hosting session. Long
loops eventually meet session compaction: keep each pass short, keep
state in the checklist file rather than memory, and expect earlier
detail to blur after a compaction boundary.`,
);
