import { defineSkill } from "../define";

/**
 * Session-to-skill (adapted from the reference project's flow for capturing
 * a live conversation as a reusable skill: candidate recognition, the
 * user-steered interview collapsed into plain-text clarification, and the
 * file form mapped onto this harness's two skills roots. The source's
 * interactive question tool and its extra frontmatter fields have no
 * counterpart here — the loader reads name and description only, and the
 * body states that boundary).
 */
export const sessionToSkillSkill = defineSkill(
  "session-to-skill",
  "Turn a repeated process from this session into a reusable skill: recognize the candidate, distill it into generic steps with success checks, write the SKILL.md under a skills root, and verify it from a fresh session",
  `# Session to skill

Some conversations prove a procedure: a multi-step way of working that this
session got right, often after a wrong first attempt. Capture that
procedure as an on-demand skill so the next session starts from the method
instead of rediscovering it.

## Recognize what is worth keeping

Two signals mark a candidate. One: the same steps ran more than once, with
only the specifics changing between runs. Two: a
wrong path was taken and corrected, and the correction would apply again
next time — the places where the user steered you are the highest-value
material, because they mark exactly where the naive approach fails. A
one-off answer or a bare fact is memory material, not a skill; a skill is
a way of working.

## Distill before writing

Rewrite the procedure as instructions a stranger could follow in a
different workspace:

- Strip the session-specific detail. Absolute paths, generated ids, and
  one-time values become parameters the future caller supplies; keep only
  the shape of the work.
- Keep the steps in their working order, one step per instruction, and say
  for each what proves it worked — an exit code, an artifact that now
  exists, a check that now passes — so a later run knows when to move on.
- Carry the hard rules the user enforced, especially the corrections, as
  explicit constraints. What the session learned the hard way is the core
  of the skill, not decoration.

## Write the file

Put it at \`.innocence/skills/<name>/SKILL.md\` under the workspace for
workflows tied to this repository, or \`~/.innocence/skills/<name>/SKILL.md\`
for personal ones that travel across workspaces. Name it in lowercase with
hyphens. The frontmatter carries exactly two fields, name and description:
those are the fields the loader reads, and the description is the line the
skills index shows, so make it state when the skill applies — open with
"Use when ..." and include a phrase or two a user might actually type.
The body below the closing fence is the instruction text itself.

Prefer editing an existing skill over accumulating near-duplicates, and
pick a fresh name when the chosen one already exists in an earlier root:
same-name entries in later roots are shadowed, not merged.

## Verify it works

Open a fresh session and run the /name invocation — the expansion loads
the body ahead of your input. Walk the steps once against a real task. If
the skill never surfaces when it should, rewrite the description: trigger
wording, not the body, is what usually fails. When the body itself proves
wrong, fix it in place and say so; a skill is a living document, and the
next correction is simply the next revision.`,
);
