import { defineSkill } from "../define";

/**
 * Agent harness design heuristics (adapted from the reference project's
 * agent design patterns guide, vendor terms removed): tool granularity,
 * context economy, validation loops, delegation boundaries and failure
 * recovery for an agent harness.
 */
export const agentDesignPatternsSkill = defineSkill(
  "agent-design-patterns",
  "Design heuristics for agent harnesses: tool granularity, context economy, output validation, delegation, failure recovery",
  `# Design patterns for agent harnesses

Heuristics for assembling an agent harness that stays reliable as it grows. They concern shape and discipline, not any particular model or vendor.

## Tool granularity

Give each tool one purpose and a name that states it. Several small tools beat one parameter-swollen tool: the caller picks correctly more often, and the harness can gate each action by its real risk. Validate arguments at the boundary and fail loudly on malformed input instead of letting bad calls sink into deeper layers. Reserve confirmation prompts for actions that are hard to undo.

## Context economy

The conversation window is a budget. Keep resident instructions small and stable; pull reference material in only at the moment a task needs it, and let it fall away afterwards. Summarize or compact long histories rather than letting stale turns accumulate. Loading a directory of focused documents on demand beats pasting every document up front.

## Validation loops

Treat generated output as a proposal, not a fact. Wherever output triggers action — a command, a file edit, a structured payload — run a programmatic check first: parse it, lint it, or dry-run it, and feed failures back for a retry. Structured formats with schema checks beat prose that must be guessed at.

## Delegation boundaries

When splitting work across subagents, make every subtask self-contained: its brief carries the goal, the relevant context, the constraints, and the expected deliverable shape. A subtask that must keep asking questions back has been cut wrong. Keep the coordinator's synthesis step explicit so partial results merge deliberately.

## Failure recovery

Assume every external call can fail. Attach a retry with backoff for transient faults, a degradation path for when a capability is unavailable, and an honest error report when neither applies. Bounded timeouts and explicit cancellation keep one stuck step from stalling the whole run, and enough logging at each failure point lets you diagnose without re-running blindly.`,
);
