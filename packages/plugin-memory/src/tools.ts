// Memory tools (batch 4B task 1): write/list/read over the dual-root store.
// Factory form — roots arrive as host-injected getters (tests pass tmp dirs,
// the session composition passes the user data root and the workspace root).
// Complete invocation args are retained for display and audit. LLM-facing
// output text is English; tool descriptions follow the repository's Chinese
// style.
import { type Tool } from "@innocenceharness/harness-tools";
import {
  listEntries,
  readEntry,
  validMemoryId,
  writeEntry,
  type MemoryScope,
} from "./store";

export const MEMORY_WRITE_TOOL_NAME = "memory_write";
export const MEMORY_LIST_TOOL_NAME = "memory_list";
export const MEMORY_READ_TOOL_NAME = "memory_read";

/** Index rows cap their first-line preview at this many characters. */
const FIRST_LINE_CAP = 80;

/** Host-injected roots: user entries span projects, project entries stay local. */
export interface MemoryToolsOptions {
  getUserRoot(): string;
  getProjectRoot(): string;
}

/** Confirmation after an accepted write. English, mode-neutral; adapts the
 *  upstream memory-guidance semantics (whole-document replacement, durable
 *  knowledge over transient state, save-in-the-same-reply timing) as a
 *  restructured rewrite — never verbatim. Exported for
 *  text-discipline tests. */
export const MEMORY_WRITE_STORED = [
  "The memory document is stored. The written body replaces the entire entry:",
  "a line left out of this write is gone, so carry over everything worth",
  "keeping. Store lasting knowledge about this environment and the way work",
  "is done here; passing task state belongs elsewhere. When the user corrects",
  "you or states a preference, record the lesson in that same reply instead",
  "of deferring it.",
].join(" ");

/** Rejection when the visible entry already exists and overwrite was not set. */
export const MEMORY_WRITE_REJECTED = [
  "A memory document with this id already exists and stays unchanged. Read it",
  "first, carry over every line worth keeping, then submit again with",
  "overwrite set to true.",
].join(" ");

/** Empty-index line for memory_list. */
export const MEMORY_LIST_EMPTY = [
  "No memory documents are indexed yet. Create the first one with",
  "memory_write.",
].join(" ");

/** Miss path for memory_read: names the legitimate discovery route only. */
export const MEMORY_READ_MISS = [
  "No memory document exists under this id. Call memory_list to see the ids",
  "available in this session, then read the one you need.",
].join(" ");

function normalizedScope(value: unknown): MemoryScope {
  return value === "user" ? "user" : "project";
}

function normalizedTags(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((tag): tag is string => typeof tag === "string" && tag.length > 0)
    : [];
}

/** Parses and validates write args. */
function requireWrite(args: Record<string, unknown>): {
  id: string;
  content: string;
  tags: string[];
  scope: MemoryScope;
  overwrite: boolean;
} {
  if (!validMemoryId(args.id)) {
    throw new Error("id 必须是非空单段文件名（禁止路径分隔符、点前缀、首尾空白）");
  }
  if (typeof args.content !== "string" || args.content.trim().length === 0) {
    throw new Error("缺少必填参数 content（非空字符串）");
  }
  if (args.tags !== undefined) {
    if (!Array.isArray(args.tags)) throw new Error("可选参数 tags 必须是字符串数组");
    for (const tag of args.tags) {
      if (typeof tag !== "string" || tag.length === 0 || tag.trim() !== tag || /\s/.test(tag)) {
        throw new Error("tags 的每个成员必须是无空白单段字符串");
      }
    }
  }
  if (args.scope !== undefined && args.scope !== "user" && args.scope !== "project") {
    throw new Error("可选参数 scope 只能是 user 或 project");
  }
  if (args.overwrite !== undefined && typeof args.overwrite !== "boolean") {
    throw new Error("可选参数 overwrite 必须是布尔值");
  }
  return {
    id: args.id,
    content: args.content,
    tags: normalizedTags(args.tags),
    scope: normalizedScope(args.scope),
    overwrite: args.overwrite === true,
  };
}

/** One index row: `id [scope] #tag1 #tag2 — first-line` (preview capped).
 *  Exported because the first-turn injection renders the same row shape —
 *  one surface, one formatter. */
export function formatIndexRow(entry: {
  id: string;
  scope: MemoryScope;
  tags: readonly string[];
  firstLine: string;
}): string {
  const tags = entry.tags.length > 0 ? ` ${entry.tags.map((tag) => `#${tag}`).join(" ")}` : "";
  return `${entry.id} [${entry.scope}]${tags} — ${entry.firstLine.slice(0, FIRST_LINE_CAP)}`;
}

/** Creates the three memory tools bound to the injected roots. Root order is
 *  fixed [user, project]: the user root shadows the project root on equal
 *  ids, matching the plugin resolver's dual-root direction. */
export function createMemoryTools(options: MemoryToolsOptions): Tool[] {
  const shadowRoots = (): readonly string[] => [options.getUserRoot(), options.getProjectRoot()];

  const memoryWrite: Tool = {
    name: MEMORY_WRITE_TOOL_NAME,
    description:
      "写入或整体替换一条记忆条目（scope user 跨项目 / project 本项目，默认 project）：content 是完整替换而非追加，要保留的行必须随本次写入带上；沉淀持久的偏好、纠正与环境认知，不存临时任务状态——用户当轮给出纠正或偏好时即写；替换已存在的可见条目（含被用户根影子覆盖的）需先读原文并显式 overwrite:true；可先用 memory_list 查看已有条目。",
    readOnly: false,
    sideEffect: "paths",
    parameters: {
      type: "object",
      properties: {
        id: { type: "string", description: "条目 id（单段文件名，全局索引键）" },
        content: { type: "string", description: "完整正文（整体替换，非追加）" },
        tags: { type: "array", items: { type: "string" }, description: "检索标签（可选，成员为无空白单段字符串）" },
        scope: { type: "string", enum: ["user", "project"], description: "存储域（可选，默认 project）" },
        overwrite: { type: "boolean", description: "替换已存在条目必须显式传 true" },
      },
      required: ["id", "content"],
    },
    async validateArgs(args) {
      requireWrite(args);
    },
    permissionResource(args) {
      // 权限面只携带 id 键（非正文）；声明覆写意图时加 ":overwrite" 后缀，
      // 让会话级授权按普通写入与替换两个粒度分别记录。
      if (!validMemoryId(args.id)) return { action: "write", kind: "memory", scope: "invalid" };
      return {
        action: "write",
        kind: "memory",
        scope: args.overwrite === true ? `${args.id}:overwrite` : args.id,
      };
    },
    async execute(args) {
      // execute 必须自守：validateArgs 的收窄不跨签名边界。
      if (!validMemoryId(args.id)) return { content: "id 非法（路径分隔符、点前缀或空白）", isError: true };
      if (typeof args.content !== "string" || args.content.trim().length === 0) {
        return { content: "缺少必填参数 content", isError: true };
      }
      const scope = normalizedScope(args.scope);
      // 覆写门控按合并可见视图判定：目标根没有文件但另一根的同 id 条目
      // 正被影子覆盖时，同样是"替换可见记忆"，必须显式 overwrite。
      const existing = await readEntry(shadowRoots(), args.id);
      if (existing && args.overwrite !== true) {
        return { content: MEMORY_WRITE_REJECTED, isError: true };
      }
      try {
        await writeEntry(scope === "user" ? options.getUserRoot() : options.getProjectRoot(), {
          id: args.id,
          scope,
          tags: normalizedTags(args.tags),
          body: args.content,
        });
        return { content: MEMORY_WRITE_STORED };
      } catch (err) {
        return { content: `The memory write failed: ${String(err)}`, isError: true };
      }
    },
  };

  const memoryList: Tool = {
    name: MEMORY_LIST_TOOL_NAME,
    description:
      "列出当前会话可见的记忆条目索引：无参数调用；用户根在前，同 id 时用户条目覆盖项目条目；每行形如「id [scope] #标签 — 首行摘要」（首行截 80 字符），不含正文——读正文用 memory_read；行集尾部附坏条目合并告警（只报文件名与原因）。",
    readOnly: true,
    sideEffect: "none",
    parameters: { type: "object", properties: {} },
    validateArgs() {
      // 无参工具：接受任意空载荷（executor 面契约——显式存在以便审查）。
    },
    permissionResource() {
      return { action: "read", kind: "memory", scope: "index" };
    },
    async execute() {
      const { entries, warnings } = await listEntries(shadowRoots());
      const rows = entries.length > 0 ? entries.map(formatIndexRow).join("\n") : MEMORY_LIST_EMPTY;
      // 告警尾注只含文件名与原因（store 契约），不携带条目内容。
      return { content: warnings.length > 0 ? `${rows}\nNotes: ${warnings.join("; ")}` : rows };
    },
  };

  const memoryRead: Tool = {
    name: MEMORY_READ_TOOL_NAME,
    description:
      "按 id 读取一条记忆条目的正文（frontmatter 之后的内容）：id 取自 memory_list 的索引行；读取顺序用户根在前（同 id 用户条目生效）；未命中返回错误并提示先查索引。",
    readOnly: true,
    sideEffect: "none",
    parameters: {
      type: "object",
      properties: {
        id: { type: "string", description: "条目 id（来自 memory_list 索引行）" },
      },
      required: ["id"],
    },
    async validateArgs(args) {
      if (!validMemoryId(args.id)) {
        throw new Error("id 必须是非空单段文件名（禁止路径分隔符、点前缀、首尾空白）");
      }
    },
    permissionResource(args) {
      return {
        action: "read",
        kind: "memory",
        scope: validMemoryId(args.id) ? args.id : "invalid",
      };
    },
    async execute(args) {
      if (!validMemoryId(args.id)) return { content: "id 非法（路径分隔符、点前缀或空白）", isError: true };
      const entry = await readEntry(shadowRoots(), args.id);
      if (!entry) return { content: `${MEMORY_READ_MISS} Requested id: ${args.id}`, isError: true };
      return { content: entry.body };
    },
  };

  return [memoryWrite, memoryList, memoryRead];
}
