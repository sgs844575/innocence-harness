import type { Context } from "@innocenceharness/kernel";
import type { Tool } from "@innocenceharness/harness-tools";
import { dataVisualizationEntry } from "./data/dataVisualization";
import { httpErrorCodesEntry } from "./data/httpErrorCodes";
import { toolUseConceptsEntry } from "./data/toolUseConcepts";
import { promptCachingEntry } from "./data/promptCaching";

/** The read_reference catalog: fixed order, fixed ids, English bodies. */
export const referenceCatalog = [
  dataVisualizationEntry,
  httpErrorCodesEntry,
  toolUseConceptsEntry,
  promptCachingEntry,
] as const;

export type ReferenceEntry = (typeof referenceCatalog)[number];

const REFERENCE_IDS: readonly string[] = referenceCatalog.map((entry) => entry.id);

/** Normalizes raw args to the only persisted field: a plain id string. */
function normalizeId(args: Record<string, unknown>): string {
  return typeof args.id === "string" ? args.id : "";
}

const CATALOG_LINES = referenceCatalog.map((entry) => `${entry.id} — ${entry.title}`).join("\n");

/**
 * On-demand reference reader. Reference material never lives in the system
 * prompt (cache discipline); the model resolves it entry by entry instead.
 * Pure lookup over a fixed in-process catalog — no IO, no side effects.
 */
export const readReferenceTool: Tool = {
  name: "read_reference",
  description:
    "按需读取内置参考资料正文（目录见下）。参考资料不常驻提示词；需要深入细节时先查目录再取用：\n" +
    CATALOG_LINES,
  readOnly: true,
  sideEffect: "none",
  parameters: {
    type: "object",
    properties: {
      id: { type: "string", enum: [...REFERENCE_IDS], description: "参考资料条目 id（见目录）" },
    },
    required: ["id"],
  },
  validateArgs(args) {
    if (!REFERENCE_IDS.includes(normalizeId(args))) {
      throw new Error(`id 必须是以下之一：${REFERENCE_IDS.join(" / ")}`);
    }
  },
  permissionResource(args) {
    // 固定目录枚举值：scope 是受控 id，持久化安全。
    return { action: "read", kind: "reference", scope: normalizeId(args) };
  },
  async execute(args) {
    const id = normalizeId(args);
    const entry = referenceCatalog.find((candidate) => candidate.id === id);
    if (!entry) {
      return {
        content: `未知参考资料 id。可用条目：${REFERENCE_IDS.join(" / ")}`,
        isError: true,
      };
    }
    return { content: `# ${entry.title}\n\n${entry.body}` };
  },
};

/** Reference tools plugin — registers read_reference (staging id "reference"). */
export const ReferencePlugin = {
  name: "reference",
  apply(ctx: Context) {
    ctx.tools.register(readReferenceTool);
  },
};
export default ReferencePlugin;
