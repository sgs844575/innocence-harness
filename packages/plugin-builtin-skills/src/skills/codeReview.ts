import { defineSkill } from "../define";

/**
 * Code review method (adapted from the reference project's review skill
 * family): assemble the change surface, hunt along dimensions and angles,
 * adjudicate findings in three states, sweep for gaps, then report graded
 * findings anchored to file and line. The machine-readable findings
 * envelope of the source family has no consumer here and was dropped.
 */
export const codeReviewSkill = defineSkill(
  "code-review",
  "Multi-angle change review: dimension and finder-angle passes, three-state verification, graded findings anchored to file:line",
  `# Code review method

Review a change as a pipeline: assemble the change surface, hunt from several angles, adjudicate every finding, sweep for misses, then report with grades and anchors.

## Stage 1 - Assemble the change surface

Produce the unified diff covering the full range under review, including uncommitted work when present; that diff is the scope. Then open and read completely every file the diff touches — a hunk divorced from its surrounding function hides the story. Separate what the author claims the change does from what the edit actually does; both belong in your head, and a mismatch between them is itself reportable.

## Stage 2 - Hunt along dimensions and angles

Dimensions, applied to every hunk:

- Correctness: ask which input, timing, state, or platform setting would make a given line misbehave. Watch for inverted conditions, boundary-count errors, dereferences of possibly absent values, dropped asynchrony, zero handled as missing, and failures silenced inside a catch.
- Conventions: rules the repository states for this code, from instruction files at user, root, or ancestor-directory scope. Flag a violation only when rule and offending line can both be quoted; taste is not a finding.
- Efficiency: fresh waste the edit adds — repeated computation or I/O in loops, serial steps that could batch, heavyweight work placed on startup or hot paths, long-lived captures pinning large scopes in memory. Always name the cheaper alternative.
- Altitude: check the repair sits at the right depth. One-off cases stacked onto shared machinery signal a shallow patch; generalizing the underlying mechanism is usually the sturdier move.

Angles, run as special passes:

- Removed behavior: for each deleted or replaced line, articulate the guarantee it used to provide and locate where the new code re-establishes it. An unrecovered guarantee is a candidate defect.
- Cross-file impact: list every caller of each changed symbol and check each call site against the new contract — fresh preconditions, altered return shape, novel exceptions, ordering assumptions. Inspect the callees as well.
- Language traps: the well-known footguns of the language and framework at hand, such as coercion quirks, mutable defaults, loop-variable capture, injection-prone string building, floating-point equality, and timezone arithmetic.
- Wrapping layers: when the edit introduces a cache, proxy, decorator, or adapter, confirm every operation delegates to the held instance — a layer resolving through a global or shared registry can bypass or re-enter itself — and that the surface callers rely on is fully forwarded.

## Stage 3 - Adjudicate each finding

Merge candidates describing the same defect at the same place, keeping the sharpest failure account. Then settle every survivor into exactly one state: **confirmed** (the failing scenario is demonstrated by the real code paths), **refuted** (tracked to a guard, invariant, or unreachable input — discard), or **unverifiable** (cannot be settled with the evidence at hand — keep, with the caveat stated).

Afterwards run a recall pass: revisit conclusions reached quickly, especially dismissals, so nothing was refuted by habit rather than by evidence.

## Stage 4 - Sweep for gaps

Re-read the diff once more hunting only for defects absent from the list — relocations that dropped a guard, test asymmetries, flipped defaults, second-tier traps outside the usual set. The job is gaps, never re-arguing entries already present.

## Stage 5 - Report

Grade findings as must-fix (ships a defect or breaks a stated rule), should-fix (real waste or fragility), or note (worth knowing, not blocking). Anchor each as \`path/to/file.ext:123\` with a one-line statement plus a concrete failure account. An empty list is a legitimate outcome; never pad it.`,
);
