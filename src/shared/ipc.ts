// Shared IPC contract — imported by both main and preload (bundled into each)
// so both processes rely on the same channel names and types.
import { TaskIpcChannels } from "./taskIpc";
import type { HarnessSettingsPatch } from "./settingsPatch";

export const IPC = {
  appInfo: "app:info",
  themeGet: "theme:get",
  themeSet: "theme:set",
  themeChanged: "theme:changed",
  uiNewSession: "ui:new-session",
  menuPopup: "menu:popup",
  sessionsList: "sessions:list",
  sessionCreate: "session:create",
  sessionDelete: "session:delete",
  sessionsChanged: "sessions:changed",
  messagesList: "messages:list",
  chatSend: "chat:send",
  chatStop: "chat:stop",
  chatDelta: "chat:delta",
  chatDone: "chat:done",
  chatError: "chat:error",
  // Harness additions (M3) — additive only, existing channels untouched.
  chatPermission: "chat:permission",
  chatPermissionRespond: "chat:permission-respond",
  chatTool: "chat:tool",
  chatThinking: "chat:thinking",
  workspacePick: "workspace:pick",
  settingsGet: "settings:get",
  settingsSet: "settings:set",
  settingsModelsList: "settings:models-list",
  settingsApiKeySet: "settings:api-key-set",
  settingsEnrichModels: "settings:enrich-models",
  // 插件清单投影（1c）：main 按当前 toggles 现算的 manifest 投影。
  pluginsList: "plugins:list",
  pluginsChanged: "plugins:changed",
  // 技能发现/导入（任务 4）：main 探测外部智能体目录 / 复制到用户技能根。
  skillsDiscover: "skills:discover",
  skillsImport: "skills:import",
  // MCP 标准格式导入（任务 5）：main 解析项目 .mcp.json / 探测发现提示。
  mcpImport: "mcp:import",
  mcpDiscover: "mcp:discover",
  // Task review/route/complete channels (Task 7).
  ...TaskIpcChannels,
} as const;

export type ThemeMode = "system" | "dark" | "light";
export type ResolvedTheme = "dark" | "light";
export type MenuId = "file" | "edit" | "view" | "help";

export interface AppInfo {
  version: string;
  platform: NodeJS.Platform;
  locale: string;
}

export interface TextPart { type: "text"; text: string }
export interface ThinkingPart { type: "thinking"; text: string }
export interface ToolCallPart {
  type: "toolCall";
  id: string;
  toolName: string;
  args: Record<string, unknown>;
}
export interface ToolResultPart {
  type: "toolResult";
  toolCallId: string;
  content: string;
  isError: boolean;
  durationMs?: number;
}
export type MessagePart = TextPart | ThinkingPart | ToolCallPart | ToolResultPart;

export interface ChatCompletionMetadata {
  providerId?: string;
  modelId?: string;
  finishReason: "stop" | "length" | "content-filter" | "tool-calls" | "error" | "aborted" | "other";
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
    reasoningTokens?: number;
    cachedInputTokens?: number;
  };
  aborted: boolean;
  /** Opaque response correlation id; never request content or credentials. */
  responseId?: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  parts: MessagePart[];
  createdAt: number;
  streaming?: boolean;
  /** Optional to keep previously persisted renderer records readable. */
  completion?: ChatCompletionMetadata;
}

/** 所有 text part 的拼接（标题、引用、纯文本场景）。 */
export function messageText(parts: MessagePart[]): string {
  return parts
    .filter((p): p is TextPart => p.type === "text")
    .map((p) => p.text)
    .join("");
}

/** 不可变地把 delta 追加到末尾 text part（React state 更新用）。 */
export function appendText(parts: MessagePart[], delta: string): MessagePart[] {
  if (!delta) return parts;
  const last = parts[parts.length - 1];
  if (last?.type === "text") {
    const next = [...parts];
    next[next.length - 1] = { type: "text", text: last.text + delta };
    return next;
  }
  return [...parts, { type: "text", text: delta }];
}

export interface Session {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
  /** 会话绑定的项目根目录；空串 = 不在项目中。侧边栏按它分组。 */
  workspaceRoot?: string;
}

export interface ChatDeltaEvent {
  sessionId: string;
  messageId: string;
  delta: string;
}

export interface ChatDoneEvent {
  sessionId: string;
  messageId: string;
  /** Optional to preserve compatibility with pre-metadata hosts. */
  completion?: ChatCompletionMetadata;
}

export interface ChatErrorEvent {
  sessionId: string;
  messageId: string;
  error: string;
}

export interface ChatToolEvent {
  sessionId: string;
  messageId: string;
  part: ToolCallPart | ToolResultPart;
}
export interface ChatThinkingEvent {
  sessionId: string;
  messageId: string;
  delta: string;
}

// ---- Harness contract (M3+) -------------------------------------------------

export type PermissionChoice = "allow" | "allowSession" | "deny";
// Mirror contract: this union matches the settings domain without importing it.
export type ProviderKind = "openai" | "anthropic" | "google";
/** Provider wire protocol, explicitly derived from kind rather than endpoint text. */
export type ProviderProtocol = "openai-compatible" | "anthropic-messages" | "google-generative";
export type PermissionMode = "auto" | "ask" | "plan" | "full";

// 镜像契约：AgentId 复制自 packages/harness-electron/src/agents.ts
// （shared 不 import 包），修改任何一侧时必须同步另一侧
// （packages/harness-electron/tests/mirror.test.ts 有 drift-guard）。
export type AgentId = "default" | "plan" | "full";

// Plugin-toggle source is defined here because both host settings and the
// main-process resolver consume this IPC-compatible payload. Keys stay open:
// any plugin id maps to a boolean.
export type PluginToggleSource = Record<string, boolean>;

// Inventory projection DTOs are defined here because both IPC endpoints use
// the same payload; the main-process projection imports these types.
/** 插件开关的解析状态（active / 配置停用 / 依赖连带停用 / 配置块校验失败降级）。 */
export type PluginInventoryState =
  | "active"
  | "disabled-by-config"
  | "dependency-disabled"
  | "config-invalid";

/** 设置页插件清单的一条投影（IPC plugins:list 载荷）。 */
export interface PluginInventoryEntry {
  /** 清单 id（manifest 派生，如 example/subagent/...）。 */
  id: string;
  /** 中性展示名（包 description 投影）。 */
  title: string;
  /** 恒开（core 条目：开关呈禁用态）。 */
  core: boolean;
  /** 是否带渲染层模块（构建后 dist/client.js）。 */
  client: boolean;
  /** 清单派生的可开关标记（core 恒 false；开关可操作面）。 */
  toggleable: boolean;
  /** 按当前 toggles 现算的解析状态。 */
  state: PluginInventoryState;
  /** 停用获胜层（active 恒 default）。 */
  via: "user" | "project" | "default";
}

export type PluginInventory = PluginInventoryEntry[];

// 镜像契约：以下发现 DTO 复制自 src/main/skillDiscovery.ts 的
// DiscoveredSkill（shared 不 import main），修改任何一侧时必须同步另一侧
// （packages/harness-electron/tests/mirror.test.ts 有 drift-guard）。
/** 外部技能发现清单的一条条目（IPC skills:discover 载荷）。 */
export interface DiscoveredSkillMirror {
  name: string;
  description: string;
  sourceDir: string;
  origin: string;
  imported: boolean;
}

// 镜像契约：以下 MCP 导入 DTO 复制自 src/main/mcpImport.ts 的
// McpServerEntry/McpImportResult（shared 不 import main），修改任何一侧时
// 必须同步另一侧（packages/harness-electron/tests/mirror.test.ts 有 drift-guard）。
/** .mcp.json 中一条 MCP 服务器条目（IPC mcp:import 载荷形状）。 */
export interface McpServerEntryMirror {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

/** MCP 导入结果（imported 名称清单 + 同名跳过清单）。 */
export interface McpImportResultMirror {
  imported: string[];
  skipped: { name: string; reason: "duplicate" | "invalid-entry" }[];
}

// 镜像契约：以下两个类型复制自 packages/harness-electron/src/modelPresets.ts
// （shared 不 import 包），修改任何一侧时必须同步另一侧。
export type ModelSource = "preset" | "fetch" | "manual";

export interface ModelInfo {
  id: string;
  name?: string;
  group?: string;
  contextWindow?: number;
  maxInput?: number;
  maxOutput?: number;
  vision?: boolean;
  tools?: boolean;
  reasoning?: boolean;
  reasoningEfforts?: string[];
  streaming?: boolean;
  source: ModelSource;
  /** 用户手改保护：enrich 不覆盖已 dirty 模型的任何字段。 */
  dirty?: boolean;
}

// 镜像契约：以下资源类型镜像 packages/harness-permissions/src/policy.ts 的
// PermissionResource（shared 不 import 包），修改任何一侧时必须同步另一侧
// （packages/harness-electron/tests/mirror.test.ts 有 drift-guard）。
/** 脱敏持久化资源：工具调用作用的对象摘要，raw 值永不进入。 */
export interface PermissionResourceInfo {
  /** 资源类别（path/command/url…）。 */
  kind: string;
  /** 资源上的动作（read/write/execute…）。 */
  action: string;
  /** 稳定作用域（工作区相对路径、命令摘要、脱敏 URL…）。 */
  scope: string;
  /** 后续 schema 脱敏预留的附加元数据（P2/P3）。 */
  metadata?: Record<string, unknown>;
}

export interface ChatPermissionEvent {
  sessionId: string;
  messageId: string;
  requestId: string;
  toolName: string;
  args: Record<string, unknown>;
  /** 本次调用作用的脱敏资源摘要（来自持久化的 PermissionRequest）。 */
  resource: PermissionResourceInfo;
}

/** One configured platform (preset or custom). */
export interface ProviderProfile {
  id: string;
  name: string;
  kind: ProviderKind;
  /** Renderer never receives a credential. It submits updates only through setProviderApiKey. */
  apiKey: string;
  /** Opaque host storage reference; safe to persist and mirror. */
  apiKeyRef?: string;
  /** Whether the host has a legacy or secured credential for this profile. */
  apiKeyConfigured?: boolean;
  baseURL: string;
  enabled: boolean;
  models: ModelInfo[];
  preset?: boolean;
}

export interface HarnessSettings {
  profiles: ProviderProfile[];
  activeProfileId: string;
  activeModel: string;
  workspaceRoot: string;
  permissionMode: PermissionMode;
  /** UI theme preference; "system" follows nativeTheme. */
  themeMode?: ThemeMode;
  /** Preferred UI language; "" follows the system locale. */
  locale?: "zh-CN" | "en-US" | "";
  /** 思考档位（""=跟随模型默认；off/low/medium/high/max）。与 harness-electron 同步。 */
  reasoningEffort?: "" | "off" | "low" | "medium" | "high" | "max";
  /** 当前内置 agent（default/plan/full），决定系统提示词。与 harness-electron 同步。 */
  activeAgent?: AgentId;
  /** 用户级插件开关（四键 subagent/skills/mcp/todo）；缺失键 = 默认开。
   *  项目 .innocence/plugins.yml 优先于此设置。与 harness-electron 同步。 */
  pluginToggles?: PluginToggleSource;
  /** 外部技能目录发现开关；缺失/非法值默认开启。与 harness-electron 同步。 */
  externalSkillDiscovery?: boolean;
  /** 外部编辑器启动命令（工作台入口，Task 11）；"" = 未配置。与
   * harness-electron 同步（首个 token 可带引号；多余 token 作前置参数）。 */
  externalEditorCommand?: string;
}

/** AddProviderDialog 的预设选项（PROVIDER_PRESET_MIRROR 的条目形状）。 */
export interface ProviderPresetMirror {
  name: string;
  kind: ProviderKind;
  baseURL: string;
  models: string[];
}

// 镜像契约：与 harness-electron settings.ts 的同名常量保持一致（shared 不
// import 包），渲染层从这里取，避免各组件散落 "__mock__"/"mock" 魔法串。
// 修改任何一侧时必须同步另一侧（tests/mirror.test.ts 有 drift-guard）。
export const MOCK_PROFILE_ID = "__mock__";
export const MOCK_MODEL = "mock";

// 与 harness-electron PROVIDER_PRESETS（packages/harness-electron/src/settings.ts）
// 同步的轻量镜像：渲染层无法 import node 侧包，添加厂家对话框的预设列表与
// 默认值从这里取。修改任何一侧时必须同步另一侧。
export const PROVIDER_PRESET_MIRROR: ProviderPresetMirror[] = [
  { name: "OpenAI", kind: "openai", baseURL: "", models: ["gpt-5", "gpt-5-mini", "gpt-4.1", "gpt-4o"] },
  { name: "Anthropic", kind: "anthropic", baseURL: "", models: ["claude-opus-4-5", "claude-sonnet-4-5", "claude-haiku-4-5"] },
  { name: "DeepSeek", kind: "openai", baseURL: "https://api.deepseek.com/v1", models: ["deepseek-chat", "deepseek-reasoner"] },
  { name: "Gemini", kind: "openai", baseURL: "https://generativelanguage.googleapis.com/v1beta/openai", models: ["gemini-2.5-pro", "gemini-2.5-flash"] },
  { name: "Native generative", kind: "google", baseURL: "", models: ["gemini-2.5-pro", "gemini-2.5-flash"] },
  { name: "阿里云百炼", kind: "openai", baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1", models: ["qwen3-max", "qwen-max", "qwen-plus", "qwen-turbo"] },
  { name: "智谱开放平台", kind: "openai", baseURL: "https://open.bigmodel.cn/api/paas/v4", models: ["glm-4.6", "glm-4.5", "glm-4.5-air"] },
  { name: "Moonshot", kind: "openai", baseURL: "https://api.moonshot.cn/v1", models: ["kimi-k2-0905-preview", "kimi-k2-turbo-preview"] },
  { name: "xAI", kind: "openai", baseURL: "https://api.x.ai/v1", models: ["grok-4", "grok-4-fast", "grok-3"] },
  { name: "Mistral", kind: "openai", baseURL: "https://api.mistral.ai/v1", models: ["mistral-large-latest", "mistral-small-latest"] },
  { name: "硅基流动", kind: "openai", baseURL: "https://api.siliconflow.cn/v1", models: ["deepseek-ai/DeepSeek-V3.2", "Qwen/Qwen3-235B-A22B"] },
  { name: "OpenRouter", kind: "openai", baseURL: "https://openrouter.ai/api/v1", models: ["openai/gpt-5", "anthropic/claude-sonnet-4.5", "google/gemini-2.5-pro"] },
  { name: "Ollama 本地", kind: "openai", baseURL: "http://localhost:11434/v1", models: ["qwen3:8b", "llama3.1:8b"] },
];

export interface InnocenceCodeApi {
  getAppInfo(): Promise<AppInfo>;
  getTheme(): Promise<{ mode: ThemeMode; resolved: ResolvedTheme }>;
  setTheme(mode: ThemeMode): Promise<void>;
  onThemeChanged(cb: (mode: ThemeMode, resolved: ResolvedTheme) => void): () => void;
  listSessions(): Promise<Session[]>;
  createSession(options?: { title?: string; workspaceRoot?: string }): Promise<Session>;
  deleteSession(id: string): Promise<void>;
  /** Fired after every session-store mutation (create/delete/append/retitle). */
  onSessionsChanged(cb: (list: Session[]) => void): () => void;
  listMessages(sessionId: string): Promise<ChatMessage[]>;
  sendMessage(sessionId: string, text: string): Promise<{ messageId: string }>;
  stopMessage(sessionId: string, messageId: string): Promise<void>;
  onChatDelta(cb: (e: ChatDeltaEvent) => void): () => void;
  onChatDone(cb: (e: ChatDoneEvent) => void): () => void;
  onChatError(cb: (e: ChatErrorEvent) => void): () => void;
  onChatTool(cb: (e: ChatToolEvent) => void): () => void;
  onChatThinking(cb: (e: ChatThinkingEvent) => void): () => void;
  onChatPermission(cb: (e: ChatPermissionEvent) => void): () => void;
  respondChatPermission(requestId: string, choice: PermissionChoice): Promise<void>;
  pickWorkspace(): Promise<string>;
  getHarnessSettings(): Promise<HarnessSettings>;
  /** Applies a settings patch to the latest committed host settings and returns its redacted projection. */
  setHarnessSettings(settings: HarnessSettingsPatch): Promise<HarnessSettings>;
  /** Stores or clears a key in host-only secured storage; it is never returned to the renderer. */
  setProviderApiKey(profileId: string, apiKey: string): Promise<HarnessSettings>;
  /** 插件清单投影（main 按当前 toggles 现算；设置写入后重拉即刷新）。 */
  getPluginInventory(): Promise<PluginInventory>;
  /** Fired after a development plugin client reload request. */
  onPluginsChanged(cb: () => void): () => void;
  /** 外部技能发现清单（main 探测已知外部智能体目录）。 */
  discoverSkills(): Promise<DiscoveredSkillMirror[]>;
  /** 导入一条已发现的技能到用户技能根（失败抛错由调用方提示）。 */
  importSkill(discovered: DiscoveredSkillMirror): Promise<void>;
  /** 解析并合并项目 .mcp.json 文本到 <root>/.innocence/config.json（损坏抛错由调用方提示）。 */
  importMcpServers(root: string, text: string): Promise<McpImportResultMirror>;
  /** 项目根 .mcp.json 路径或 null（发现提示用）。 */
  discoverMcpFile(root: string): Promise<string | null>;
  listProviderModels(profileId: string): Promise<string[]>;
  /** 用 harness-electron 预设目录补全模型元数据（main 侧 modelFromPreset）。 */
  enrichModels(providerName: string, ids: string[]): Promise<ModelInfo[]>;
  onMenuNewSession(cb: () => void): () => void;
  popupMenu(id: MenuId): Promise<void>;
}
