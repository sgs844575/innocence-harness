// Shared IPC contract — imported by both main and preload (bundled into each)
// so both processes rely on the same channel names and types.
import { SidebarIpcChannels, type SidebarApi } from "./sidebarIpc";
import { TaskIpcChannels } from "./taskIpc";
import { AutomationIpcChannels, type AutomationApi } from "./automationIpc";
import type { HarnessSettingsPatch } from "./settingsPatch";

export const IPC = {
  appInfo: "app:info",
  /** 顶栏应用菜单「进程监视器」：app.getAppMetrics 的投影。 */
  appMetrics: "app:metrics",
  /** 顶栏应用菜单「导出日志」：选目录后复制 userData/logs 全部日志文件。 */
  appExportLogs: "app:export-logs",
  themeGet: "theme:get",
  themeSet: "theme:set",
  themeChanged: "theme:changed",
  // 自绘窗口控制（Win/Linux 无边框标题栏）：最小化/最大化切换/关闭与状态。
  windowMinimize: "window:minimize",
  windowToggleMaximize: "window:toggle-maximize",
  windowClose: "window:close",
  windowMaximizedGet: "window:maximized-get",
  windowMaximizedChanged: "window:maximized-changed",
  uiNewSession: "ui:new-session",
  menuPopup: "menu:popup",
  sessionsList: "sessions:list",
  sessionCreate: "session:create",
  sessionDelete: "session:delete",
  sessionFork: "session:fork",
  backgroundStart: "background:start",
  sessionsChanged: "sessions:changed",
  messagesList: "messages:list",
  chatSend: "chat:send",
  /** 编辑重发（替换语义）：截断 fromMessageId 起的消息后以新文本重开一轮。 */
  chatResend: "chat:resend",
  chatStop: "chat:stop",
  chatDelta: "chat:delta",
  chatDone: "chat:done",
  chatError: "chat:error",
  // Harness additions (M3) — additive only, existing channels untouched.
  chatPermission: "chat:permission",
  chatPermissionRespond: "chat:permission-respond",
  chatTool: "chat:tool",
  chatThinking: "chat:thinking",
  subagentLifecycle: "subagent:lifecycle",
  /** 子代理运行档案回放：按会话拉取落盘的 lifecycle 记录（重启后建档）。 */
  subagentHistory: "subagent:history",
  /** 取消一个存活子代理运行（childId = lifecycle 事件 id = 运行注册表 id）。 */
  subagentCancel: "subagent:cancel",
  workspacePick: "workspace:pick",
  /** 落地页分支胶囊：探测任意项目根的 Git 分支（非仓库/失败 → null）。 */
  workspaceGitBranch: "workspace:git-branch",
  /** Git 面板更改统计：工作区相对 HEAD 的 diff 概览（非仓库/失败 → null）。 */
  workspaceGitChanges: "workspace:git-changes",
  /** 分支面板：本地分支列表 + 当前分支（非仓库/失败 → null）。 */
  workspaceGitBranches: "workspace:git-branches",
  /** 分支面板：切换或新建并检出分支（用户从分支面板显式触发）。 */
  workspaceGitCheckout: "workspace:git-checkout",
  /** 侧栏文件树：单级目录列举（懒加载）。 */
  workspaceListDir: "workspace:list-dir",
  /** 侧栏文件树：受限文本读取（大小/二进制闸门）。 */
  workspaceReadFile: "workspace:read-file",
  /** 侧栏文件树搜索：全量文件清单（忽略 .git/node_modules，有上限）。 */
  workspaceListFiles: "workspace:list-files",
  /** 审查面板：改动文件列表（unstaged/staged；非仓库 → null）。 */
  workspaceGitReviewFiles: "workspace:git-review-files",
  /** 审查面板：单文件 unified diff（未跟踪文件返回全文；非仓库/失败 → null）。 */
  workspaceGitReviewDiff: "workspace:git-review-diff",
  /** dock 浏览器标签：访客页设备度量仿真（Emulation.setDeviceMetricsOverride）。 */
  browserEmulate: "browser:emulate",
  /** 会话「…」菜单：在系统文件管理器中打开目录。 */
  hostRevealPath: "host:reveal-path",
  /** 会话「…」菜单：打开外部链接（仅 http/https）。 */
  hostOpenExternal: "host:open-external",
  /** 会话「…」菜单：会话产物路径（任务转录文件/当前日志文件）。 */
  sessionPaths: "session:paths",
  settingsGet: "settings:get",
  settingsSet: "settings:set",
  settingsModelsList: "settings:models-list",
  settingsApiKeySet: "settings:api-key-set",
  settingsEnrichModels: "settings:enrich-models",
  // 插件清单投影（1c）：main 按当前 toggles 现算的 manifest 投影。
  pluginsList: "plugins:list",
  pluginsChanged: "plugins:changed",
  // Agent 模式目录（任务 13）：main 按 manifest + 用户根扫描现算的模式目录。
  agentsModes: "agents:modes",
  // 技能发现/导入（任务 4）：main 探测外部智能体目录 / 复制到用户技能根。
  skillsDiscover: "skills:discover",
  skillsImport: "skills:import",
  // MCP 标准格式导入（任务 5）：main 解析项目 .mcp.json / 探测发现提示。
  mcpImport: "mcp:import",
  mcpDiscover: "mcp:discover",
  ...TaskIpcChannels,
  ...SidebarIpcChannels,
  ...AutomationIpcChannels,
} as const;

export type ThemeMode = "system" | "dark" | "light";
export type ResolvedTheme = "dark" | "light";
export type MenuId = "file" | "edit" | "view" | "help";

export interface AppInfo {
  version: string;
  platform: NodeJS.Platform;
  locale: string;
}

/** 进程监视器的一行（app.getAppMetrics 的渲染层投影；内存已从 KB 折算 MB）。 */
export interface AppProcessMetric {
  pid: number;
  /** Electron 进程类别名（Browser/Tab/GPU/Utility…），原样展示。 */
  type: string;
  cpuPercent: number;
  memoryMB: number;
}

export interface TextPart { type: "text"; text: string }
export interface ThinkingPart { type: "thinking"; text: string }
export interface ToolCallPart {
  type: "toolCall";
  id: string;
  toolName: string;
  args: Record<string, unknown>;
  /** Per-invocation id, when the runtime forwarded one (joins subagent runs). */
  invocationId?: string;
}
export interface ToolResultPart {
  type: "toolResult";
  toolCallId: string;
  content: string;
  isError: boolean;
  durationMs?: number;
  /** Matches the toolCall part of the same invocation, when known. */
  invocationId?: string;
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
  /** M1 会话 fork 血缘：父会话与切口消息（信息性；旧索引缺省）。 */
  forkedFrom?: { sessionId: string; messageId?: string };
  /** 右侧 dock 辅助对话会话：不进侧边栏会话列表（dock 自管理生命周期）。 */
  aux?: boolean;
}

/** 审查面板作用域：未暂存（工作区 vs index）/ 已暂存（index vs HEAD）。 */
export type ReviewScope = "unstaged" | "staged";

/** 审查面板文件条目（untracked = 未跟踪新文件）。 */
export interface ReviewFileEntry {
  path: string;
  additions: number;
  deletions: number;
  untracked?: boolean;
}

/** 单文件 diff：patch = git unified diff 文本；untracked = 新文件全文。 */
export type ReviewFileDiffResult = { kind: "patch"; patch: string } | { kind: "untracked"; text: string } | null;

/** dock 浏览器设备仿真请求：width/height 为 null = 清除覆盖（适应窗口）。 */
export interface BrowserEmulateRequest {
  /** <webview> 访客 id（webview.getWebContentsId()）。 */
  guestId: number;
  width: number | null;
  height: number | null;
  mobile: boolean;
}

/** 侧栏文件树的目录条目（rel 为工作区相对路径，"/" 分隔）。 */
export interface WorkspaceDirEntry {
  name: string;
  rel: string;
  isDir: boolean;
}

/** 侧栏文件树的文件内容（二进制不返回内容）。 */
export interface WorkspaceFileContent {
  content: string;
  truncated: boolean;
  binary: boolean;
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

export type SubagentStatus = "started" | "running" | "completed" | "failed" | "cancelled";

export interface SubagentLifecycleEvent {
  childId: string;
  parentSessionId: string;
  description: string;
  status: SubagentStatus;
  /** Correlation key of the spawning Task invocation, when scope was bound. */
  parentInvocationId?: string;
  /** Agent preset id and task prompt (started event only). */
  agentType?: string;
  prompt?: string;
  /** Present only on the running event that reopens a completed run for a
   *  continuation (resume); the prompt field carries the follow-up on it. */
  resumed?: true;
  delta?: string;
  /** Streaming reasoning text (same cadence as delta; not persisted). */
  thinkingDelta?: string;
  /** Closed reasoning segment (running events): emitted when reasoning ends —
   *  before the first following text delta, before any tool activity, and
   *  before terminal/error events. Unlike thinkingDelta it is persisted, so
   *  history replay rebuilds the thinking rows. */
  thinkingSegment?: string;
  /** Closed assistant text segment (running events): emitted at tool-activity
   *  boundaries and before terminal/error events so the body renders
   *  interleaved with the tool trail; unlike delta it is persisted. */
  textSegment?: string;
  /** Tool activity inside the child, on running events. */
  tool?: {
    name: string;
    phase: "call" | "result";
    isError?: boolean;
    title?: string;
    /** Call-phase bounded args projection (harness-agent clipToolArgs). */
    args?: Record<string, unknown>;
    result?: string;
  };
  final?: string;
  error?: string;
}

// ---- Harness contract (M3+) -------------------------------------------------

export type PermissionChoice = "allow" | "allowSession" | "deny";
export function isPermissionChoice(value: unknown): value is PermissionChoice {
  return value === "allow" || value === "allowSession" || value === "deny";
}
// Mirror contract: this union matches the settings domain without importing it.
export type ProviderKind = "openai" | "anthropic" | "google";
/** Provider wire protocol, explicitly derived from kind rather than endpoint text. */
export type ProviderProtocol = "openai-compatible" | "anthropic-messages" | "google-generative";
export type PermissionMode = "auto" | "ask" | "plan" | "full";

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

/** IPC agents:modes 载荷：一个可选择的 agent 模式（插件贡献）。 */
export interface AgentModeInfo {
  id: string;
  title: string;
  description?: string;
}

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
  /** 视频输入能力标记（展示用）。 */
  video?: boolean;
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
/** 持久化资源：工具调用作用的对象摘要（与 persistArgs 同粒度）。 */
export interface PermissionResourceInfo {
  /** 资源类别（path/command/url…）。 */
  kind: string;
  /** 资源上的动作（read/write/execute…）。 */
  action: string;
  /** 稳定作用域（工作区相对路径、完整命令、URL…）。 */
  scope: string;
  /** 附加元数据（P2/P3 预留）。 */
  metadata?: Record<string, unknown>;
}

export interface ChatPermissionEvent {
  sessionId: string;
  messageId: string;
  requestId: string;
  toolName: string;
  args: Record<string, unknown>;
  /** 本次调用作用的资源摘要（来自持久化的 PermissionRequest）。 */
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
  /** 界面字号（px，12..18；缺失/非法回落 14）。纯渲染层外观，注入
   *  --font-size-ui，与 harness-electron 同步持久化。 */
  uiFontSize?: number;
  /** 代码字号（px，12..18；缺失/非法回落 14）。代码块/终端/审查 diff 内容
   *  注入 --font-size-code，与 harness-electron 同步持久化。 */
  codeFontSize?: number;
  /** 浅色界面的代码高亮主题（shiki bundled 名，默认 github-light）。 */
  codeThemeLight?: string;
  /** 深色界面的代码高亮主题（默认 github-dark）。 */
  codeThemeDark?: string;
  /** 代码块显示行号；默认开。 */
  codeLineNumbers?: boolean;
  /** 代码内容长行自动换行；默认关（横向滚动）。 */
  codeWordWrap?: boolean;
  /** Preferred UI language; "" follows the system locale. */
  locale?: "zh-CN" | "en-US" | "";
  /** 思考档位（""=跟随模型默认；off/low/medium/high/max）。与 harness-electron 同步。 */
  reasoningEffort?: "" | "off" | "low" | "medium" | "high" | "max";
  /** 当前 agent 模式 id（插件贡献，开放集合；非法回落 default）。与 harness-electron 同步。 */
  activeAgentMode?: string;
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

export interface InnocenceCodeApi extends SidebarApi, AutomationApi {
  getAppInfo(): Promise<AppInfo>;
  /** 进程监视器：当前各进程 CPU/内存快照（顶栏应用菜单）。 */
  getAppMetrics(): Promise<AppProcessMetric[]>;
  /** 导出日志：选目录后复制全部日志文件；返回复制数，取消/无日志 → null。 */
  exportLogs(): Promise<{ exported: number } | null>;
  getTheme(): Promise<{ mode: ThemeMode; resolved: ResolvedTheme }>;
  setTheme(mode: ThemeMode): Promise<void>;
  onThemeChanged(cb: (mode: ThemeMode, resolved: ResolvedTheme) => void): () => void;
  minimizeWindow(): Promise<void>;
  toggleMaximizeWindow(): Promise<void>;
  closeWindow(): Promise<void>;
  isWindowMaximized(): Promise<boolean>;
  onWindowMaximizedChanged(cb: (maximized: boolean) => void): () => void;
  listSessions(): Promise<Session[]>;
  createSession(options?: { title?: string; workspaceRoot?: string; aux?: boolean }): Promise<Session>;
  deleteSession(id: string): Promise<void>;
  /** M1 会话 fork：按用户消息切口分叉出新会话；无效切口/父会话缺失返回 null。
   *  worktree=true 为工作树分叉（父 Git 工作区自 HEAD 建分离工作树并绑定为
   *  新会话根；非 Git/失败返回 null）。 */
  forkSession(
    sessionId: string,
    options?: { upToMessageId?: string; worktree?: boolean },
  ): Promise<Session | null>;
  /** S1 后台作业：新建后台会话并机器身份触发一次自含运行；即回工作态。
   *  workspaceRoot 绑定作业会话的项目根（缺省回落全局设置根）。 */
  startBackgroundJob(
    prompt: string,
    options?: { workspaceRoot?: string },
  ): Promise<{ jobId: string; sessionId: string; status: "working" }>;
  /** Fired after every session-store mutation (create/delete/append/retitle). */
  onSessionsChanged(cb: (list: Session[]) => void): () => void;
  listMessages(sessionId: string): Promise<ChatMessage[]>;
  /** userMessageId：渲染层乐观用户气泡的 id，主进程落账沿用同一 id，
   *  保证后续编辑重发的截断能在存储中找到这条消息。 */
  sendMessage(sessionId: string, text: string, userMessageId?: string): Promise<{ messageId: string }>;
  /** 编辑重发：替换 fromMessageId（含）之后的消息并以 text 重开一轮；
   *  运行中/任务绑定会话或未知消息 id 时主进程抛错由渲染层提示。
   *  newMessageId 为乐观新用户气泡的 id，落账沿用（同 sendMessage）。 */
  resendMessage(sessionId: string, fromMessageId: string, text: string, newMessageId?: string): Promise<{ messageId: string }>;
  stopMessage(sessionId: string, messageId: string): Promise<void>;
  onChatDelta(cb: (e: ChatDeltaEvent) => void): () => void;
  onChatDone(cb: (e: ChatDoneEvent) => void): () => void;
  onChatError(cb: (e: ChatErrorEvent) => void): () => void;
  onChatTool(cb: (e: ChatToolEvent) => void): () => void;
  onChatThinking(cb: (e: ChatThinkingEvent) => void): () => void;
  onSubagentLifecycle(cb: (e: SubagentLifecycleEvent) => void): () => void;
  /** 子代理运行档案：按会话读回落盘的 lifecycle 记录（重启后回放建档）。 */
  listSubagentHistory(sessionId: string): Promise<{ at: number; event: SubagentLifecycleEvent }[]>;
  /** 取消一个存活子代理运行；返回是否命中存活注册表项（终态/未知 id → false）。 */
  cancelSubagent(sessionId: string, childId: string): Promise<boolean>;
  onChatPermission(cb: (e: ChatPermissionEvent) => void): () => void;
  respondChatPermission(requestId: string, choice: PermissionChoice): Promise<void>;
  pickWorkspace(): Promise<string>;
  /** 探测项目根的当前 Git 分支；非 Git 仓库或探测失败返回 null（胶囊隐藏）。 */
  workspaceGitBranch(root: string): Promise<string | null>;
  /** 工作区相对 HEAD 的 diff 概览（更改文件数/增删行）；非 Git 或失败返回 null。 */
  workspaceGitChanges(root: string): Promise<{ changedFiles: number; additions: number; deletions: number } | null>;
  /** 本地分支列表与当前分支；非 Git 仓库或失败返回 null。 */
  workspaceGitBranches(root: string): Promise<{ current: string | null; branches: string[] } | null>;
  /** 切换分支（create=true 时新建并检出）；失败返回 error 摘要。 */
  workspaceGitCheckout(root: string, branch: string, create?: boolean): Promise<{ ok: boolean; branch?: string; error?: string }>;
  /** 侧栏文件树：单级目录列举（目录在前、按名排序）。 */
  listWorkspaceDir(root: string, relDir: string): Promise<WorkspaceDirEntry[]>;
  /** 侧栏文件树：读取文本文件（超限截断；二进制只回标记）。 */
  readWorkspaceFile(root: string, rel: string): Promise<WorkspaceFileContent>;
  /** 侧栏文件树搜索：全量文件相对路径清单（忽略 .git/node_modules，封顶 2000）。 */
  listWorkspaceFiles(root: string): Promise<string[]>;
  /** 审查面板：改动文件列表；非 Git 仓库或失败返回 null（空态）。 */
  workspaceGitReviewFiles(root: string, scope: ReviewScope): Promise<{ files: ReviewFileEntry[] } | null>;
  /** 审查面板：单文件 diff（patch = unified diff 文本；untracked = 新文件全文）。 */
  workspaceGitReviewDiff(root: string, scope: ReviewScope, path: string): Promise<ReviewFileDiffResult>;
  /** dock 浏览器：设备度量仿真（null 尺寸 = 适应窗口）；仅接受本窗口的 webview 访客。 */
  browserEmulate(request: BrowserEmulateRequest): Promise<{ ok: boolean; error?: string }>;
  /** 在系统文件管理器中打开目录（失败静默）。 */
  revealPath(path: string): Promise<void>;
  /** 打开外部 http(s) 链接（其余 scheme 拒绝）。 */
  openExternal(url: string): Promise<void>;
  /** 会话产物路径：任务转录文件与当前日志文件（不存在 → null）。 */
  getSessionPaths(id: string): Promise<{ taskPath: string | null; logPath: string | null }>;
  getHarnessSettings(): Promise<HarnessSettings>;
  /** Applies a settings patch to the latest committed host settings and returns its redacted projection. */
  setHarnessSettings(settings: HarnessSettingsPatch): Promise<HarnessSettings>;
  /** Stores or clears a key in host-only secured storage; it is never returned to the renderer. */
  setProviderApiKey(profileId: string, apiKey: string): Promise<HarnessSettings>;
  /** 插件清单投影（main 按当前 toggles 现算；设置写入后重拉即刷新）。 */
  getPluginInventory(): Promise<PluginInventory>;
  /** Agent 模式目录（main 按 manifest + 用户根扫描现算；恒含 default）。 */
  listAgentModes(): Promise<AgentModeInfo[]>;
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
