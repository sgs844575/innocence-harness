/** 六类上下文构成（token 数，校准后六类之和 === 真实输入）。 */
export interface ContextBreakdown {
  systemPrompt: number;
  skills: number;
  systemTools: number;
  mcpTools: number;
  messages: number;
  other: number;
}

/** 校准前的五类原始估算（other 尚不存在）。 */
export type RawBreakdown = Omit<ContextBreakdown, "other">;

/** 计量包自有最小消息投影（结构兼容 canonical Message，不依赖任何包）。 */
export interface MessageLike {
  role: "user" | "assistant";
  parts: { type: string; text?: string; toolName?: string; args?: unknown; content?: string }[];
}

export interface ContextUsageSnapshot {
  /** 最后一步真实输入 token（服务商 usage）。 */
  inputTokens: number;
  breakdown: ContextBreakdown;
  /** cache 语义分层：loop 事件内 = 步级；宿主转发/持久化内 = 会话级累计。 */
  cache: { inputTokens: number; cachedInputTokens: number };
  modelId?: string;
}
