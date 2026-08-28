/**
 * Reference entry: prompt prefix caching. Adapted from an upstream caching
 * design document into a provider-neutral English entry — the prefix-match
 * principle, breakpoint placement, and the stability discipline that keeps
 * shared prefixes cacheable. Speaks only of "the provider".
 */
export const promptCachingEntry = {
  id: "prompt-caching",
  title: "Prompt prefix caching: principle, breakpoints, stability discipline",
  body: `# Prompt prefix caching

## Principle

Consecutive requests to the same model usually share a long, unchanged preamble — core instructions, tool manifests, conversation history. The provider therefore keys a cache on the exact rendered bytes of the prompt prefix: when the next request's opening bytes match a stored prefix, the matching portion is served from cache at a fraction of the full processing cost, and only the differing tail is handled fresh.

The corollary drives all design. Caching is a prefix match, so any difference that appears early invalidates everything positioned after it: a single altered byte near the front — a timestamp, a reordered key, one extra tool — discards the value of every breakpoint that follows it. Ordering, not marking, does the work. With a correct assembly order, caching largely happens on its own; once the order is wrong, no amount of marking recovers it.

## Breakpoint strategy

Requests declare breakpoints on content blocks, and the cache is written at each marked position.

- The count of breakpoints per request is small and fixed by the provider — plan around a handful (commonly four), never an unbounded supply.
- Place each breakpoint at a stability boundary: the end of the immutable instruction core; the end of material that changes per session; optionally the tail of the appended history, so the next turn inherits the entire prior conversation as a read.
- Marking the wrong position is worse than not marking: a breakpoint placed after content that differs on every request writes a fresh entry each time that nothing will ever read, paying the write premium for no return. Leave caching off entirely when the prompt genuinely differs from its very beginning on every request.
- Longer-lived entries cost more to write. Choose the lifetime by the spacing of the requests that share the prefix, and let frequent traffic refresh the shorter lifetime on its own.

## Stability discipline

Classify every input to the prompt by how often it changes, then lay the prompt out in exactly that order:

1. Never changes (core instructions, tool definitions): the very front.
2. Changes per session (workspace context, long-lived memory): after the frozen core.
3. Changes per turn (the growing history): next.
4. Changes per request (clock reads, request identifiers, random values): the very end — or, better, removed outright.

Audit for silent invalidators:

- Wall-clock reads or random identifiers interpolated anywhere early make every request unique.
- Serialization must be deterministic: sort object keys, avoid iterating unordered collections, pin number formatting — otherwise byte-level differences appear where the logical content is identical.
- The tool list sits at the very front of the rendered prompt. Adding, removing, or reordering a tool mid-conversation rebuilds everything after it; when a capability must change mid-flight, express the change as an appended message rather than an edit to the earlier sections.
- Operator instructions injected mid-conversation belong in a message after the cached history (a non-spoofable system-role channel, where the provider offers one), never as an edit to the top-level instructions.
- Forked sub-tasks that share a parent's context should replicate the parent's exact prefix — same instructions, same tool set, same model — and append only their specific tail; a rebuilt prefix misses the parent's cache completely.
- Switching models clears the decks: cache entries are scoped per model.

## Verification

Usage counters in each response report how many tokens came from cache reads, how many were newly written, and how many were processed uncached. Re-check them after any change to prompt assembly: a regression here is silent — requests keep succeeding while the cost profile worsens. In a healthy multi-turn loop, reads should cover the accumulated prefix and writes should approximate only the newest turn's addition; writes approaching the size of the whole conversation at each request mean the prefix is being disturbed upstream of the breakpoint. To localize an unexpected miss, diff the rendered bytes of consecutive requests within their shared region — the first divergence is the culprit (ignore the markers themselves, which legitimately move). For fan-out concurrency, note that an entry becomes readable only once the first response begins streaming: sequence one request ahead of its siblings so they read what it wrote.`,
} as const;
