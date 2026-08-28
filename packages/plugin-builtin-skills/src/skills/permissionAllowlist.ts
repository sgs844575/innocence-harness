import { defineSkill } from "../define";

/**
 * Permission allowlist derivation (adapted from the reference project's
 * transcript-mining skill, product-specific settings formats removed and
 * mapped onto this harness's session transcripts and project-level
 * permission rules): mine consistently approved requests, write minimal
 * rules, verify nothing extra slipped in, review periodically.
 */
export const permissionAllowlistSkill = defineSkill(
  "permission-allowlist",
  "Derive minimal permission allow rules from session transcripts: only consistently approved recurring requests, verified against the record, reviewed periodically",
  `# Building a permission allowlist from session records

Approving the same permission request over and over is friction with no safety gain. This method derives narrow allow rules from what the user has already approved — and only from that.

## Mine the records

Session transcripts — the persisted record of tool calls and their permission outcomes — are the source material. Scan recent sessions and collect the permission requests that recur: the same read-only command shape, the same path prefix, the same query tool, asked for again and again. Keep only patterns the user approved consistently; a pattern with mixed outcomes or a single denial is not allowlist material.

## Derive minimal rules

For each recurring pattern, write the narrowest rule that covers the observed, approved usage:

- Prefer exact command forms over prefix wildcards; widen one step at a time, and only when the recorded usage demands it.
- Scope path rules to the directory subtree actually visited, never to the whole workspace or home directory.
- Every rule must be explainable line by line: this command shape was approved N times in these sessions. A rule whose origin cannot be named does not belong in the file.

Where the harness distinguishes project-level rules from user-level ones, default to project scope — the narrower context.

## Verify nothing extra was allowed

After writing the rules, audit them against the records: walk every request each rule would have matched, and confirm the set contains no request the user never approved. A wildcard one segment too wide quietly admits an unapproved class of action; this check is the difference between an allowlist and an open door.

## Maintain

Review the list periodically. Remove entries no session has exercised since the last review, re-tighten rules whose usage has narrowed, and re-derive when the tool set or project layout changes. An allowlist grows stale in both directions: rules that no longer fire, and new recurring approvals waiting to be recorded.`,
);
