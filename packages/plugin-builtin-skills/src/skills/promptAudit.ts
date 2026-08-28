import { defineSkill } from "../define";

/**
 * Prompt audit (adapted from the reference project's prompt-audit workflow,
 * model-specific pattern tables removed): a five-question checklist over
 * instruction text — ambiguity, conflicts, hidden assumptions, leading
 * phrasing, missing output constraints — with one comparison test per fix
 * and severity-graded findings.
 */
export const promptAuditSkill = defineSkill(
  "prompt-audit",
  "Audit instruction text against a checklist: ambiguity, conflicts, hidden assumptions, leading phrasing, missing output constraints; fix and test one item at a time",
  `# Auditing prompt text

A prompt audit examines instructions the way code review examines logic: item by item, against a checklist, with a test after each fix. Audit the instruction surface as a whole — system text, tool descriptions, skill bodies, embedded examples.

## The checklist

Work through five questions over every instruction:

1. **Ambiguity.** Does the instruction admit more than one reasonable reading? Two correct implementations that disagree are evidence the text underdetermines the task.
2. **Conflicts.** Do any two instructions contradict each other — one demands brevity while another demands completeness, one forbids what another requires? The executor resolves conflicts by guesswork unless the text states which wins.
3. **Hidden assumptions.** What does the text assume without saying — that the reader knows the audience, the environment, the definition of done? State each assumption or drop the dependence on it.
4. **Leading phrasing.** Does the wording hint at the expected answer? Instructions that anticipate a conclusion bias the output toward that conclusion regardless of what the input supports.
5. **Missing output constraints.** Is the expected shape of the output stated — format, structure, what to include, what to omit? Absent format constraints are the most common source of unusable output.

## Fix and test

Repair the findings one at a time, and after each edit run a comparison test: give the same input to the instruction before and after the change — or to both readings, where the text was ambiguous — and observe the difference. A change with no detectable effect fixed nothing. One change per test keeps attribution clean.

## Grade the findings

Not every finding deserves the same urgency. Classify results as:

- **Blocking** — the instruction will produce wrong or unusable output; fix before shipping.
- **Improving** — output works but drifts or wastes effort; fix when convenient.
- **Stylistic** — cosmetic; fix only while editing anyway.

Report the graded list with locations, and apply fixes in grade order.`,
);
