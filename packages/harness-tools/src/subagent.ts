// Compatibility types for existing tool consumers. The canonical subagent
// request contract belongs to harness-agent; this module deliberately emits
// type-only exports and therefore adds no runtime dependency edge.
export type {
  SubagentOptions,
  SubagentResult,
  SubagentSpawner,
} from "@innocencecode/harness-agent";
