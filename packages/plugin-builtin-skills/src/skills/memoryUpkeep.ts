import { defineSkill } from "../define";

/**
 * Memory upkeep (adapted from the reference project's reflective
 * memory-consolidation pass, its instruction-file reconciliation, and the
 * memory attachment-selection heuristic; shared-store handling is trimmed to
 * this harness's boundary — the project root is the shared surface, with no
 * cross-team store yet. Batch 5 task 4 folds in the extraction turn-budget
 * reminder (reads gathered before writes) and the disconnected-store
 * warning (stop on an unreadable store; a stale listing is not current),
 * mapped onto a local file store that has no connection state).
 */
export const memoryUpkeepSkill = defineSkill(
  "memory-upkeep",
  "Maintain the memory store: merge duplicate entries, mark outdated ones instead of deleting, keep ids and first lines retrieval-ready, reconcile against repository instructions, and choose attachments sparingly",
  `# Memory upkeep

A maintenance pass over the memory store: merge what duplicated, mark what
expired, and keep the index honest. Run it when a session ends, when the user
asks for a cleanup, or whenever a listing shows the store drifting.

## Inspect first

Start from the lessons this session just produced, then call memory_list and
read the questionable entries with memory_read before changing anything.
Work in two batches: collect every listing and read in one stretch, then
make every edit in the next, rather than interleaving one read with one
write at a time — the grouped order spends fewer turns for the same result.
If the store itself answers with errors or comes back unreadable, stop and
say so plainly: an earlier listing is stale, not a current picture, and no
maintenance should be invented for a store that could not be read.
Judge every row as a retrieval surface: does the id still say what the entry
is, and does the first line still carry the words a later search would use?
Whatever the body says, a stale first line is a stale index row for every
future session. For a project-scope row, also weigh the team: a teammate
who never saw this session should still make sense of the entry.

## Merge near-duplicates

When several entries cover one topic, keep the id with the clearer name, fold
the still-true facts of the others into it with memory_write (a full
replacement — carry over every line worth keeping), and turn each absorbed
entry into a one-line pointer saying it is superseded and naming the
surviving id. Store absolute dates only, so notes stay readable after time
passes.

## Mark, do not erase

No tool in this pass deletes an entry, and that shape is deliberate: a
constraint that stopped holding, or a preference the user moved past, gets a
leading line saying it is outdated and why, which keeps the original
reasoning on record for reference. Correct an entry that misstates the
present at its own id instead of contradicting it from a neighbor. Before
rewriting a project-scope entry, remember it is the surface shared by
everyone working in this workspace — when unsure, leave it and name it in
the summary.

## Reconcile with the repository instructions

Where a memory overlaps the repository instruction file, the checked-in file
is the maintained source: rewrite the memory to agree or mark it outdated,
keeping any context still worth having. When the memory is clearly newer and
corrects the file, do not edit the file inside this pass — flag the conflict
for the user in the summary instead.

## Choosing what to read for a task

When picking entries to consult for a task, match what the task is about
against ids, tags, and first lines — not surface keyword overlap with a
profile-style entry. Prefer fewer: an entry you are not certain helps stays
unread. Skip anything an earlier step of the same task already pulled in.

Work through the memory tools only (list, read, write) and touch nothing
outside the store. Close the pass with a short summary: what was merged,
what was marked, what was flagged.`,
);
