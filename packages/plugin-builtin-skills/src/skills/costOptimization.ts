import { defineSkill } from "../define";

/**
 * Cost optimization for agent loops (adapted from the reference project's
 * cost-lever guide, platform-specific reporting and rate mechanics removed):
 * prefix stability for caching, fewer round trips, tier routing by task
 * difficulty, and periodic usage review against cost per completed task.
 */
export const costOptimizationSkill = defineSkill(
  "cost-optimization",
  "Lower cost per completed task: keep the request prefix stable, batch round trips, route tiers by difficulty, review usage patterns",
  `# Cost optimization for agent workloads

Optimize what a task costs end to end, never the price of a single call in isolation. A cheaper tier that fails still bills its tokens, the retry, and whatever the failure broke downstream. Four levers, in rough order of safety.

## Prefix stability

Each turn of a loop resends the stable material — instructions, tool contracts, reference policy. Order request content so the unchanging part leads and the volatile part (timestamps, per-turn state, fresh user input) trails, on the message side where possible. Anything dynamic interpolated into the stable prefix re-bills everything after it on every subsequent turn. Classify content by how often it changes and keep the rarely-changing layers ahead of the frequently-changing ones — the same volatility bucketing the harness applies to its own prompt fragments.

## Fewer, larger requests

Every round trip carries fixed overhead: the prefix, the wait, the coordination. Batch independent work into one request where the parts do not depend on each other, and merge successive small steps into one larger step when the intermediate results are not themselves needed. Batch only work that nobody is waiting on.

## Match tier to task

Route by difficulty. Heavyweight reasoning, long-horizon planning, and risky edits go to the strong tier; classification, formatting, summarization, and bulk mechanical work go to the light one. Re-examine the routing whenever the task mix shifts — the expensive failure mode is a light tier quietly failing at hard work and being retried at full price.

## Usage awareness and review

Keep token usage visible per task, not just per request. Review periodically where consumption concentrates: deep loops that accumulate tool output, reference material resent needlessly, retries that repeat a failing prefix. Name the high-consumption patterns and attack the largest one first; a lever that trims a pattern the workload barely exhibits is not worth its complexity.

Measure after changing: compare cost per completed task before and after with the quality bar held fixed. A saving that gives back accuracy is a regression wearing a discount.`,
);
