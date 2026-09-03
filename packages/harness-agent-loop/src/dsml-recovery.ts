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
