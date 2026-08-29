// First-turn memory index injection (batch 4B task 2). The processor rides
// the session's user-input pipeline and, on the owner session's first user
// message, appends one text part listing the merged dual-root index — rows
// only, never entry bodies (the session-frozen discipline), and never the
// per-entry updated stamp (byte-deterministic injected text). The wording
// adapts the reference project's memory-file-contents / nested-memory-
// contents / index-capacity-warning material as a restructured rewrite:
// the block points at entries instead of inlining their stored text.
import type { Message, MessageProcessor, MessageProcessorContext } from "@innocenceharness/harness-session";
import { listEntries, type MemoryIndex } from "./store";
import { formatIndexRow } from "./tools";

/** Processor name on the session pipeline. */
export const MEMORY_INDEX_PROCESSOR_NAME = "memory-index";

/**
 * Pipeline position: between the early skill-expansion pass (-1000) and the
 * conventionally-numbered host processors (0) — the index block lands on the
 * outbound user message before later processors append their envelopes.
 */
export const MEMORY_INDEX_PROCESSOR_ORDER = -500;

/** Rows carried before the block truncates (index capacity semantics). */
export const MEMORY_INDEX_ROW_CAP = 30;

/** Header line of the injected block. */
const HEADER_LINE = "[memory index]";

/** Truncation line when the merged index exceeds the row cap. Adapts the
 *  capacity-warning semantics: rows past the cap stay invisible to the
 *  reader of this block, so the line names the honest alternative (the full
 *  listing tool) and the compaction direction. Exported for tests. */
export const MEMORY_INDEX_CAPACITY_WARNING = (total: number): string =>
  `Capped at the first ${MEMORY_INDEX_ROW_CAP} of ${total} entries; rows past the cap are left out of this block. Call memory_list for the complete listing, and slim the store by merging near-duplicates or marking stale entries.`;

/** Tail usage guidance (2–3 sentences). Exported for text-discipline tests. */
export const MEMORY_INDEX_GUIDANCE = [
  "Each row is a pointer, not the stored text: when work touches a listed entry, read it with memory_read and follow what it says.",
  "An id missing from this list does not prove the memory is absent — a memory root may simply be unconfigured here, so check with memory_list before concluding.",
  "Keep new material out of this block: saving follows the memory discipline stated in your instructions.",
].join(" ");

/** Host-injected roots, same getters the tools factory takes. */
export interface MemoryIndexInjectionOptions {
  getUserRoot(): string;
  getProjectRoot(): string;
}

/**
 * Renders the injected block from a merged index. Undefined when the index
 * holds no entries (empty store / unconfigured roots inject nothing). Rows
 * reuse the listing tool's formatter, so the block and memory_list show one
 * identical surface; store-level degradation warnings stay off this block
 * (they name files and reasons — the listing tool carries them).
 */
export function renderMemoryIndexBlock(index: MemoryIndex): string | undefined {
  if (index.entries.length === 0) return undefined;
  const lines = [HEADER_LINE];
  const capped = index.entries.slice(0, MEMORY_INDEX_ROW_CAP);
  for (const entry of capped) lines.push(formatIndexRow(entry));
  if (index.entries.length > capped.length) {
    lines.push(MEMORY_INDEX_CAPACITY_WARNING(index.entries.length));
  }
  lines.push(MEMORY_INDEX_GUIDANCE);
  return `<system-reminder>\n${lines.join("\n")}\n</system-reminder>`;
}

/**
 * Creates the first-turn index injection processor. Gating mirrors the
 * planflow/reminders precedent: child sessions inherit this identical
 * processor instance and run through the same pipeline, so instance-scoped
 * state alone is not session-scoped — the first session seen owns the
 * injection, and any other session neither receives the block nor consumes
 * the first turn. The first-turn flag is spent once per owner regardless of
 * outcome (a failed read degrades to no injection and never retries
 * mid-session), and non-user messages pass through untouched.
 */
export function createMemoryIndexProcessor(
  options: MemoryIndexInjectionOptions,
): MessageProcessor {
  let firstTurn = true;
  let ownerSessionId: string | undefined;
  return {
    name: MEMORY_INDEX_PROCESSOR_NAME,
    order: MEMORY_INDEX_PROCESSOR_ORDER,
    async process(message: Message, context: MessageProcessorContext): Promise<Message> {
      if (message.role !== "user") return message;
      ownerSessionId ??= context.scope.sessionId;
      if (context.scope.sessionId !== ownerSessionId) return message;
      if (!firstTurn) return message;
      firstTurn = false;
      // Degrade, never throw: the input pipeline must not break because a
      // memory root went unreadable (roots resolve per call, so the getters
      // themselves can fail too — one guard covers both).
      let index: MemoryIndex;
      try {
        index = await listEntries([options.getUserRoot(), options.getProjectRoot()]);
      } catch {
        return message;
      }
      const block = renderMemoryIndexBlock(index);
      if (block !== undefined) message.parts.push({ type: "text", text: block });
      return message;
    },
  };
}
