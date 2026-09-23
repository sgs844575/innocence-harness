import type { ToolSpec } from "@innocenceharness/harness-providers";

/**
 * 兼容端点兜底：部分模型在聊天补全流里把工具调用以纯文本标记输出
 * （`<tool_call>…</tool_call>` 包裹的单次调用），而不是结构化 tool_calls
 * 字段。运行时把这种整段文本还原成规范 toolCall 事件，让代理循环继续
 * 执行，而不是把标记当成最终回答、让回合无声终止。
 *
 * 识别刻意保守，避免吞掉正文里引用标记的正常回答：
 * - 整条文本（去除首尾空白后）必须完全由完整的 `<tool_call>` 块组成；
 * - 每个块解析出的工具名必须在本次请求注册的工具表内；
 * - 任一块未闭合、无法解析或名字未知 → 整条保持纯文本。
 */
export interface TextToolCall {
  id: string;
  toolName: string;
  args: Record<string, unknown>;
}

/** 工具名集合 + 每工具的参数类型表（值按 JSON Schema 的 type 标量收敛）。 */
export interface TextToolCallTable {
  names: ReadonlySet<string>;
  argTypes: ReadonlyMap<string, ReadonlyMap<string, string>>;
}

/** 从请求工具清单构建查表；properties 形态不可靠时安全降级为空表。 */
export function textToolCallTable(tools: readonly ToolSpec[]): TextToolCallTable {
  const names = new Set<string>();
  const argTypes = new Map<string, ReadonlyMap<string, string>>();
  for (const tool of tools) {
    if (typeof tool?.name !== "string" || tool.name === "") continue;
    names.add(tool.name);
    const props = tool.parameters?.properties;
    const types = new Map<string, string>();
    if (props !== null && typeof props === "object" && !Array.isArray(props)) {
      for (const [key, raw] of Object.entries(props as Record<string, unknown>)) {
        const type = (raw as { type?: unknown } | null)?.type;
        if (typeof type === "string") types.set(key, type);
      }
    }
    argTypes.set(tool.name, types);
  }
  return { names, argTypes };
}

const OPEN_TAG_RE = /<tool_call\b[^>]*>/gi;
const CLOSE_TAG_RE = /<\/tool_call\s*>/i;

/** 拆出全部完整 `<tool_call>` 块；存在未闭合块时返回 null（绝不转换）。 */
function extractToolCallBlocks(text: string): { blocks: string[]; residue: string } | null {
  const blocks: string[] = [];
  const residueFragments: string[] = [];
  let cursor = 0;
  OPEN_TAG_RE.lastIndex = 0;
  for (let open = OPEN_TAG_RE.exec(text); open !== null; open = OPEN_TAG_RE.exec(text)) {
    const innerStart = open.index + open[0].length;
    const close = CLOSE_TAG_RE.exec(text.slice(innerStart));
    if (close === null) return null;
    residueFragments.push(text.slice(cursor, open.index));
    blocks.push(text.slice(innerStart, innerStart + close.index));
    cursor = innerStart + close.index + close[0].length;
    OPEN_TAG_RE.lastIndex = cursor;
  }
  residueFragments.push(text.slice(cursor));
  return { blocks, residue: residueFragments.join("") };
}

/**
 * 解析整条文本为工具调用。可转换时返回调用列表，否则返回 null
 * （调用方保持原文）。块外只允许空白。
 */
export function parseTextToolCalls(text: string, table: TextToolCallTable): TextToolCall[] | null {
  const extracted = extractToolCallBlocks(text);
  if (extracted === null || extracted.blocks.length === 0) return null;
  if (extracted.residue.trim() !== "") return null;

  const calls: TextToolCall[] = [];
  for (const inner of extracted.blocks) {
    const parsed = parseToolCallInner(inner.trim(), table);
    if (parsed === null || !table.names.has(parsed.toolName)) return null;
    calls.push({ id: nextTextToolCallId(), toolName: parsed.toolName, args: parsed.args });
  }
  return calls;
}

function parseToolCallInner(
  inner: string,
  table: TextToolCallTable,
): { toolName: string; args: Record<string, unknown> } | null {
  if (inner.startsWith("{")) return parseJsonToolCall(inner, table);
  return parseFunctionStyle(inner, table) ?? parseInvokeStyle(inner, table);
}

/** JSON 体：`{"name": "...", "arguments": {...}}`（arguments 允许为 JSON 字符串）。 */
function parseJsonToolCall(
  inner: string,
  table: TextToolCallTable,
): { toolName: string; args: Record<string, unknown> } | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(inner);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const record = parsed as { name?: unknown; arguments?: unknown; parameters?: unknown; args?: unknown };
  if (typeof record.name !== "string" || record.name === "") return null;
  let rawArgs = record.arguments ?? record.parameters ?? record.args ?? {};
  if (typeof rawArgs === "string") {
    try {
      rawArgs = JSON.parse(rawArgs);
    } catch {
      return null;
    }
  }
  if (rawArgs === null || typeof rawArgs !== "object" || Array.isArray(rawArgs)) return null;
  const types = table.argTypes.get(record.name);
  const args: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(rawArgs as Record<string, unknown>)) {
    args[key] = typeof value === "string" ? coerceArgValue(value, types?.get(key)) : value;
  }
  return { toolName: record.name, args };
}

/** `<function=Name>` + 若干 `<parameter=key>value` 变体。 */
function parseFunctionStyle(
  inner: string,
  table: TextToolCallTable,
): { toolName: string; args: Record<string, unknown> } | null {
  const open = /<function\b[^>]*>/i.exec(inner);
  if (open === null) return null;
  const toolName = nameFromTag(open[0]);
  if (toolName === null) return null;
  const regionStart = open.index + open[0].length;
  const closeFn = /<\/function\b[^>]*>/i.exec(inner);
  const regionEnd = closeFn === null ? inner.length : closeFn.index;
  const region = inner.slice(regionStart, regionEnd);

  const args: Record<string, unknown> = {};
  const types = table.argTypes.get(toolName);
  const paramRe = /<parameter\b[^>]*>/gi;
  const opens: Array<{ key: string; tagStart: number; valueStart: number }> = [];
  for (let match = paramRe.exec(region); match !== null; match = paramRe.exec(region)) {
    const key = nameFromTag(match[0]);
    if (key === null) return null;
    opens.push({ key, tagStart: match.index, valueStart: match.index + match[0].length });
  }
  for (let index = 0; index < opens.length; index += 1) {
    const current = opens[index]!;
    const next = opens[index + 1]?.tagStart ?? region.length;
    const value = region
      .slice(current.valueStart, next)
      .replace(/<\/parameter\s*>\s*$/i, "")
      .trim();
    args[current.key] = coerceArgValue(unescapeEntities(value), types?.get(current.key));
  }
  return { toolName, args };
}

/** `<invoke name="Name">` + 子元素 `<key>value</key>` 变体。 */
function parseInvokeStyle(
  inner: string,
  table: TextToolCallTable,
): { toolName: string; args: Record<string, unknown> } | null {
  const open = /<invoke\b[^>]*>/i.exec(inner);
  if (open === null) return null;
  const toolName = nameFromTag(open[0]);
  if (toolName === null) return null;
  const regionStart = open.index + open[0].length;
  const closeInvoke = /<\/invoke\b[^>]*>/i.exec(inner);
  const region = inner.slice(regionStart, closeInvoke === null ? inner.length : closeInvoke.index);

  const args: Record<string, unknown> = {};
  const types = table.argTypes.get(toolName);
  const childRe = /<([A-Za-z_][A-Za-z0-9_.\-]*)((?:\s[^>]*)?)>([\s\S]*?)<\/\1\s*>/g;
  for (let match = childRe.exec(region); match !== null; match = childRe.exec(region)) {
    const tagName = match[1]!;
    const key = tagName === "parameter" ? nameFromTag(`<x${match[2] ?? ""}>`) ?? tagName : tagName;
    const value = unescapeEntities(match[3] ?? "").trim();
    args[key] = coerceArgValue(value, types?.get(key));
  }
  return { toolName, args };
}

/** 从开标签里取工具名/参数名：优先 `name="X"` 属性，其次首个 `=X` 内联值。 */
function nameFromTag(tag: string): string | null {
  const attr = /\bname\s*=\s*["']?([A-Za-z0-9_.\-]+)/i.exec(tag);
  if (attr !== null) return attr[1]!;
  const inline = /=\s*["']?([A-Za-z0-9_.\-]+)/.exec(tag);
  return inline !== null ? inline[1]! : null;
}

/** 文本标记里的值恒为字符串；仅当参数声明了标量类型时收敛，其余保持原文。 */
function coerceArgValue(value: string, type: string | undefined): unknown {
  switch (type) {
    case "number":
    case "integer": {
      if (value.trim() === "") return value;
      const num = Number(value);
      return Number.isFinite(num) ? num : value;
    }
    case "boolean":
      if (value === "true") return true;
      if (value === "false") return false;
      return value;
    case "object":
    case "array": {
      if (value.trim() === "") return type === "array" ? [] : {};
      try {
        return JSON.parse(value);
      } catch {
        return value;
      }
    }
    default:
      return value;
  }
}

function unescapeEntities(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

let textToolCallSeq = 0;

function nextTextToolCallId(): string {
  textToolCallSeq += 1;
  const random = Math.random().toString(16).slice(2, 10);
  return `textcall-${textToolCallSeq.toString(36)}-${random}`;
}

export type TextToolCallGateOutput =
  | { kind: "text"; text: string }
  | { kind: "calls"; calls: TextToolCall[] };

/**
 * 流式文本门：首个非空白字符决定后续路径——像 `<tool_call` 开头的消息进入
 * 整段持有模式（标记从不流出），其余立即直通。finish 时对持有文本做整体
 * 解析：可转换则产出调用，否则原样吐回文本；中止/出错路径一律按文本吐回。
 */
export interface TextToolCallGate {
  /** 喂入一个文本增量；返回此刻可以放行的文本（无则 null）。 */
  pushText(delta: string): string | null;
  /** 流正常结束：返回转换出的调用，或持有文本的原文（幂等）。 */
  finalize(): TextToolCallGateOutput[];
  /** 流中止/出错：把持有内容按文本吐回（幂等）。 */
  flushAsText(): string | null;
}

const OPENER_PREFIX = "<tool_call";

export function createTextToolCallGate(table: TextToolCallTable): TextToolCallGate {
  let state: "buffering" | "passthrough" | "candidate" | "settled" = "buffering";
  let buffer = "";

  // 前缀已完整且下一字符不属于合法开标签形态时立即放弃持有（防误吞正文）。
  const looksLikeOpenTag = (text: string): boolean => {
    if (!text.startsWith(OPENER_PREFIX)) return false;
    const next = text.charAt(OPENER_PREFIX.length);
    return next === "" || next === ">" || next === "/" || /\s/.test(next);
  };

  return {
    pushText(delta) {
      if (delta === "") return null;
      if (state === "passthrough") return delta;
      if (state === "candidate") {
        buffer += delta;
        return null;
      }
      if (state !== "buffering") return null;
      buffer += delta;
      const trimmed = buffer.replace(/^\s+/, "");
      if (trimmed === "") return null;
      if (looksLikeOpenTag(trimmed)) {
        state = "candidate";
        return null;
      }
      if (OPENER_PREFIX.startsWith(trimmed)) return null;
      state = "passthrough";
      const released = buffer;
      buffer = "";
      return released;
    },
    finalize() {
      if (state === "settled") return [];
      const held = buffer;
      buffer = "";
      if (state === "candidate") {
        state = "settled";
        const calls = parseTextToolCalls(held, table);
        if (calls !== null && calls.length > 0) return [{ kind: "calls", calls }];
        return [{ kind: "text", text: held }];
      }
      state = "settled";
      return held === "" ? [] : [{ kind: "text", text: held }];
    },
    flushAsText() {
      if (state === "settled" || state === "passthrough") {
        state = "settled";
        return null;
      }
      const held = buffer;
      buffer = "";
      state = "settled";
      return held === "" ? null : held;
    },
  };
}
