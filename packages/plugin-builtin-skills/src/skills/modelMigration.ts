import { defineSkill } from "../define";

/**
 * Model migration discipline (adapted from the reference project's
 * migration guide, per-vendor syntax matrices removed): baseline the old
 * behavior first, re-verify every capability assumption, re-check parameter
 * semantics, cut over gradually with a retained rollback path, and regress
 * against the baseline.
 */
export const modelMigrationSkill = defineSkill(
  "model-migration",
  "Move workloads between model generations safely: baseline first, re-verify capabilities and parameter semantics, cut over gradually, regress against the baseline",
  `# Model migration discipline

Moving a workload from one model generation to another is a behavior change dressed as a configuration change. The sequence below keeps it verifiable.

## Establish the baseline first

Before touching any setting, make current behavior measurable: run the existing use cases — the suite, the eval, the recorded golden transcripts — against the current model and record the outcome. Everything green (and every known failure documented) is the reference all later comparisons read against. A migration without a baseline cannot be said to have succeeded.

## Zero out capability assumptions

Assume nothing carries over. Verify on the new model, one item at a time:

- **Tool calling**: argument shapes, error paths, behavior on malformed tool definitions.
- **Structured output**: schema adherence, edge cases in serialization, failure modes of over-constrained schemas.
- **Context window**: effective size, truncation behavior at the boundary, how position within the window affects recall.

Each capability that behaves differently is a migration finding to record, not a surprise to discover in production.

## Parameter semantics

Parameters with the same name do not mean the same thing across generations. Re-check the semantics of sampling controls (temperature and its relatives — whether they are supported at all, their ranges, their interactions), truncation and length limits (what happens at the cap, what streaming requires), and system-prompt handling (precedence, merging, how literally instructions there are followed). Defaults are part of the contract: an untouched parameter may still behave differently because its default moved.

## Cut over gradually, keep the way back

Switch traffic in stages — one call site, then one workload class, then a shadow run comparing outputs — with the old path retained and reversible until the new one has earned trust. A rollback that requires redoing the migration in reverse is not a rollback path.

## Regress against the baseline

After cutover, run the same use cases from the baseline step and compare. Differences are findings to adjudicate: some are regressions to fix, some are improvements to keep, some are neutral shifts to document. Re-run after any prompt tuning that follows the migration; the migration and its re-tuning form one event until the baseline is green again on the new model.`,
);
