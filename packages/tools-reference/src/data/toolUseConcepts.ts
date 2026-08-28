/**
 * Reference entry: tool-calling concepts. Adapted from an upstream tool
 * use concepts document into a host-neutral English entry — the calling
 * loop, the distinction between invalid invocations and failed
 * executions, and principles for designing the tool surface itself.
 */
export const toolUseConceptsEntry = {
  id: "tool-use-concepts",
  title: "Tool-calling loop, failure semantics, and tool-surface design",
  body: `# The tool-calling loop

## Loop shape

A tool-augmented exchange runs as a cycle owned by the caller:

1. The model receives the conversation plus the tool manifests and answers either with plain content or with one or more structured calls, each naming a tool and supplying arguments.
2. The runtime checks every call: does the named tool exist, do the arguments fit the declared schema, do permission rules allow the action?
3. Calls that pass execute against the real world — filesystem, network, process, or a domain service.
4. Every call, success or failure, is appended back into the conversation as a result bound to its call identifier, and the cycle repeats from the first step.
5. The loop ends when the model answers without requesting a tool; that answer is the turn's result.

Preserve the pairing between call and result exactly: a result bound to the wrong call identifier poisons all subsequent reasoning over the transcript.

## Failure semantics: two distinct kinds

- Invalid invocation. The tool name, argument shape, or permission failed the pre-checks — the tool never ran. Report it as an argument problem, naming the offending field (never echoing its value), and let the model correct and re-issue the call. A schema rejection is recoverable by construction: the remedy is a better-formed request, so an immediate retry with fixed arguments is sound.
- Failed execution. The tool ran and the operation itself failed — a missing file, a refused connection, a timeout, a domain error. Feed the failure back as that call's result with the error flag set and a message describing what went wrong. The model then chooses among an alternate route, alternate arguments, or escalating to the user; re-issuing an identical call is usually wrong, and repeated identical failures are a signal to change approach.
- Keep the two channels separate in the transport. Validation rejections happen before any side effect; execution failures happen after. Collapsing them teaches the model to "fix" arguments for failures that arguments cannot fix.

## Designing the tool surface

- Descriptions decide invocation. State when the tool applies — the trigger conditions — in addition to what it does; a description that only names the mechanism leaves the model guessing about applicability. Spell out exclusions as well ("prefer the other tool when…").
- Parameters should self-describe: meaningful names, enumerated values wherever the option set is fixed, defaults for commonly omitted options, and required marking only for what genuinely must arrive. Every parameter carries its own description.
- Keep the surface small and orthogonal. Many overlapping tools dilute selection; when a family grows, prefer one tool with a mode argument over near-duplicate siblings.
- Bound the output. Return what the next reasoning step needs; truncate the remainder with a marker and a way to fetch more. Oversized results crowd the context without improving decisions.
- Multiple calls in a single model turn are a feature: run the independent ones concurrently and return all of their results together before the next model step; dependent calls must wait for the earlier result.
- Side-effecting tools deserve explicit confirmation paths and dry-run forms where feasible; mark read-only tools as such so conservative modes can allow them without asking.`,
} as const;
