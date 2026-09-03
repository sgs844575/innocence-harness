// 原生工具调用标记回收：部分混合推理模型在流式/长上下文里会退化为把
// 工具调用以原生标记（DSML 信封）写进正文文本通道，而不是结构化
// tool_calls——正文渲染出整段标记且调用不执行。本纯函数在轮次落账前把
// 完整信封还原成结构化 toolCall 部件（invoke 名 + 参数，string 标志区分
// 字符串/数值）并从文本中剥离；不完整信封（流被截断）保持原样不猜。
import type { MessagePart, ToolCallPart } from "@innocenceharness/harness-session";

/** 信封外层：<｜DSML｜｜tool_calls>…</｜DSML｜｜tool_calls>（｜ 为全角竖线 U+FF5C）。 */
const ENVELOPE_PATTERN = /<｜DSML｜｜tool_calls>([\s\S]*?)<\/｜DSML｜｜tool_calls>/g;
/** 单次调用：<｜DSML｜｜invoke name="Read">…</｜DSML｜｜invoke>。 */
const INVOKE_PATTERN = /<｜DSML｜｜invoke\s+name="([^"]*)"\s*>([\s\S]*?)<\/｜DSML｜｜invoke>/g;
/** 单个参数：string="true" 为字符串原样，string="false" 为 JSON/数值。 */
const PARAM_PATTERN = /<｜DSML｜｜parameter\s+name="([^"]*)"\s+string="([^"]*)"\s*>([\s\S]*?)<\/｜DSML｜｜parameter>/g;
/** 廉价预判：正文里出现标记开头才进入解析路径。 */
const MARKER_HEAD = "<｜DSML｜｜";
/** 信封闭合标记（流式守卫的吞没终点）。 */
const MARKER_CLOSE = "</｜DSML｜｜tool_calls>";

function parseNonString(raw: string): unknown {
  const trimmed = raw.trim();
  if (trimmed === "") return raw;
  try {
    return JSON.parse(trimmed);
  } catch {
    const numeric = Number(trimmed);
    return Number.isFinite(numeric) ? numeric : raw;
  }
}

function parseInvokes(body: string, nextCallId: () => string): ToolCallPart[] {
  const calls: ToolCallPart[] = [];
  for (const invoke of body.matchAll(INVOKE_PATTERN)) {
    const toolName = (invoke[1] ?? "").trim();
    if (toolName === "") continue;
    const args: Record<string, unknown> = {};
    for (const param of (invoke[2] ?? "").matchAll(PARAM_PATTERN)) {
      const name = param[1] ?? "";
      if (name === "") continue;
      args[name] = param[2] === "false" ? parseNonString(param[3] ?? "") : param[3] ?? "";
    }
    calls.push({ type: "toolCall", id: nextCallId(), toolName, args });
  }
  return calls;
}

/**
 * 把文本部件中的完整 DSML 信封还原为结构化 toolCall 部件（追加在尾部，
 * 由调用方的正常管线执行/落账），并从文本中剥离信封；信封剥离后仅剩
 * 空白的文本部件一并丢弃。无标记时原样返回入参引用（零开销路径）。
 */
export function recoverDsmlToolCalls(
  parts: readonly MessagePart[],
  nextCallId: () => string,
): MessagePart[] {
  let touched = false;
  const kept: MessagePart[] = [];
  const recovered: ToolCallPart[] = [];
  for (const part of parts) {
    if (part.type !== "text" || !part.text.includes(MARKER_HEAD)) {
      kept.push(part);
      continue;
    }
    touched = true;
    const stripped = part.text.replace(ENVELOPE_PATTERN, (_all, body: string) => {
      recovered.push(...parseInvokes(body, nextCallId));
      return "";
    });
    if (stripped.trim().length > 0) kept.push({ type: "text", text: stripped });
  }
  if (!touched) return parts as MessagePart[];
  return [...kept, ...recovered];
}

/**
 * 流式展示过滤器：从 `<｜DSML｜｜` 出现到其闭合之间的 token 全部抑制
 * （标记可能被任意拆分在多个增量里，故维护前缀保持状态），标记之外的
 * 文本立即直通。只影响展示事件——部件累积保留全文供
 * {@link recoverDsmlToolCalls} 落账前回收。
 */
export interface DsmlTokenFilter {
  /** 喂入一个文本增量，返回可安全外发的部分（"" = 全部保持/抑制）。 */
  push(text: string): string;
  /** 流结束：释放被保持的非标记尾巴（形似标记前缀但终究不是）。 */
  flush(): string;
}

export function createDsmlTokenFilter(): DsmlTokenFilter {
  let buffer = "";
  let insideMarker = false;
  /** buffer 尾部与标记头的最长公共前缀（保持待判）。 */
  const heldPrefixLength = (): number => {
    for (let length = Math.min(buffer.length, MARKER_HEAD.length - 1); length > 0; length -= 1) {
      if (buffer.endsWith(MARKER_HEAD.slice(0, length))) return length;
    }
    return 0;
  };
  return {
    push(text: string): string {
      buffer += text;
      let emit = "";
      for (;;) {
        if (insideMarker) {
          const closerAt = buffer.indexOf(MARKER_CLOSE);
          if (closerAt < 0) {
            // 未闭合：只保留足以跨增量拼出闭合串的尾巴，其余抑制丢弃。
            const carry = Math.min(buffer.length, MARKER_CLOSE.length - 1);
            buffer = buffer.slice(buffer.length - carry);
            break;
          }
          buffer = buffer.slice(closerAt + MARKER_CLOSE.length);
          insideMarker = false;
          continue;
        }
        const headAt = buffer.indexOf(MARKER_HEAD);
        const hold = heldPrefixLength();
        if (headAt < 0) {
          emit += buffer.slice(0, buffer.length - hold);
          buffer = buffer.slice(buffer.length - hold);
          break;
        }
        emit += buffer.slice(0, headAt);
        buffer = buffer.slice(headAt + MARKER_HEAD.length);
        insideMarker = true;
      }
      return emit;
    },
    flush(): string {
      const released = insideMarker ? "" : buffer;
      buffer = "";
      insideMarker = false;
      return released;
    },
  };
}
