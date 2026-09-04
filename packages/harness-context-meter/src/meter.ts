import type { ContextUsageSnapshot, MessageLike, RawBreakdown } from "./types";
import { estimateTokens } from "./estimate";

export interface MeterRequest {
  systemSegments: { prompt: string; skills?: string };
  /** schemaText = 描述 + 参数 schema 文本化（调用方拼装）；name 只用于 mcp__ 前缀分类，不计入成本。 */
  tools: { name: string; schemaText: string }[];
  messages: readonly MessageLike[];
}

/** 文本化规则：text/thinking 取 text；toolCall 取 toolName+JSON(args)；
 *  toolResult 取 content；其余忽略。 */
function messageText(message: MessageLike): string {
  let out = "";
  for (const part of message.parts) {
    if ((part.type === "text" || part.type === "thinking") && typeof part.text === "string") {
      out += part.text;
    } else if (part.type === "toolCall") {
      out += `${part.toolName ?? ""}${JSON.stringify(part.args ?? {})}`;
    } else if (part.type === "toolResult") {
      out += typeof part.content === "string" ? part.content : "";
    }
  }
  return out;
}

/** 五类未校准估算（other 由校准残差产生）。 */
export function breakdownFromRequest(request: MeterRequest): RawBreakdown {
  let systemTools = 0;
  let mcpTools = 0;
  for (const tool of request.tools) {
    const cost = estimateTokens(tool.schemaText);
    if (tool.name.startsWith("mcp__")) mcpTools += cost;
    else systemTools += cost;
  }
  let messages = 0;
  for (const message of request.messages) messages += estimateTokens(messageText(message));
  return {
    systemPrompt: estimateTokens(request.systemSegments.prompt),
    skills: estimateTokens(request.systemSegments.skills ?? ""),
    systemTools,
    mcpTools,
    messages,
  };
}

/** 用真实输入 token 校准：五类等比缩放，残差归 other（≥0），总和恒等。 */
export function calibrate(
  raw: RawBreakdown,
  actualInputTokens: number,
  meta?: { modelId?: string; cachedInputTokens?: number },
): ContextUsageSnapshot {
  const rawTotal = raw.systemPrompt + raw.skills + raw.systemTools + raw.mcpTools + raw.messages;
  const scale = rawTotal > 0 && actualInputTokens > 0 ? actualInputTokens / rawTotal : 0;
  const scaled = {
    systemPrompt: Math.floor(raw.systemPrompt * scale),
    skills: Math.floor(raw.skills * scale),
    systemTools: Math.floor(raw.systemTools * scale),
    mcpTools: Math.floor(raw.mcpTools * scale),
    messages: Math.floor(raw.messages * scale),
  };
  const other = Math.max(
    0,
    actualInputTokens -
      scaled.systemPrompt - scaled.skills - scaled.systemTools - scaled.mcpTools - scaled.messages,
  );
  return {
    inputTokens: actualInputTokens,
    breakdown: { ...scaled, other },
    cache: {
      inputTokens: actualInputTokens,
      cachedInputTokens: meta?.cachedInputTokens ?? 0,
    },
    ...(meta?.modelId ? { modelId: meta.modelId } : {}),
  };
}
