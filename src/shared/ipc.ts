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
  /** 常规设置「数据存储位置」：当前数据根与默认根。 */
  appGetDataRoot: "app:get-data-root",
  /** 常规设置「数据存储位置」：目录选择对话框（取消 → null）。 */
  appPickDirectory: "app:pick-directory",
  /** 常规设置「数据存储位置」：迁移数据根并重启（失败 → ok:false 不重启）。 */
  appSetDataRoot: "app:set-data-root",
  /** 常规设置「终端字体」：生效字体解析（覆盖/系统终端探测；无 → null）。 */
  terminalResolvedFont: "terminal:resolved-font",
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
  sessionRename: "session:rename",
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
  /** 询问卡（ask_user 工具）：主进程推送结构化问题，渲染层作答后回传。 */
  chatQuestion: "chat:question",
  chatQuestionRespond: "chat:question-respond",
  /** 询问卡落定通知：非渲染层落定（超时跳过/停止/关机）时主进程广播清卡。 */
  chatQuestionSettled: "chat:question-settled",
  /** 询问卡回放：会话激活时拉取该会话仍挂起的问题卡（切会话回来补卡）。 */
  chatPendingQuestions: "chat:pending-questions",
  chatTool: "chat:tool",
  chatThinking: "chat:thinking",
  /** 上下文容量指示器：主路由计量快照推送（每步一条，富化后载荷）。 */
  chatContextUsage: "chat:context",
  /** 上下文容量指示器：按会话查询当前快照（重启回放/切会话补拉；无 → null）。 */
  contextUsageQuery: "chat:context-usage-query",
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
  /** Git 图谱对话框：全分支提交图数据（非仓库/失败 → null）。 */
  workspaceGitGraph: "workspace:git-graph",
  /** 提交面板：提交（stageAll 时先 add -A；message 为空时自动生成）。 */
  workspaceGitCommit: "workspace:git-commit",
  /** 提交面板：推送（无上游时自动 --set-upstream origin HEAD）。 */
  workspaceGitPush: "workspace:git-push",
  /** 提交面板：AI 生成提交信息（基于 status + diff --stat 摘要）。 */
  workspaceGitCommitMessage: "workspace:git-commit-message",
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

/** 提交/推送操作结果：summary = git 输出末行摘要；error = 失败摘要。 */
export interface WorkspaceGitActionResult {
  ok: boolean;
  summary?: string;
  error?: string;
}

/** AI 提交信息生成结果。 */
export interface WorkspaceGitCommitMessageResult {
  ok: boolean;
  message?: string;
  error?: string;
}

/** Git 图谱提交上的引用徽标（branch = 本地分支，remote = 远端跟踪，tag = 标签）。 */
export interface GitGraphRef {
  name: string;
  kind: "branch" | "remote" | "tag";
}

/** Git 图谱单条提交（at = Unix 秒；parents 为全哈希）。 */
export interface GitGraphCommit {
  hash: string;
  parents: string[];
  author: string;
  at: number;
  subject: string;
  refs: GitGraphRef[];
}

/** Git 图谱数据：head = 当前分支名（分离头/空仓 → null）；truncated = 历史超限截断。 */
export interface GitGraphData {
  head: string | null;
  commits: GitGraphCommit[];
  truncated: boolean;
}

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

// 镜像契约：以下类型复制自 packages/harness-context-meter/src/types.ts
// （shared 不 import 包），修改任何一侧时必须同步另一侧
// （packages/harness-electron/tests/mirror.test.ts 有 drift-guard）。
/** 六类上下文构成（token 数；六类之和 = 该步真实输入）。 */
export interface ChatContextBreakdown {
  systemPrompt: number;
  skills: number;
  systemTools: number;
  mcpTools: number;
  messages: number;
  other: number;
}

/** 主路由上下文计量快照（运行时富化后的会话级视图）。 */
export interface ChatContextUsageSnapshot {
  /** 最后一步真实输入 token（服务商 usage）。 */
  inputTokens: number;
  breakdown: ChatContextBreakdown;
  /** cache 语义分层：钩子/持久化载荷内 = 会话级累计。 */
  cache: { inputTokens: number; cachedInputTokens: number };
  modelId?: string;
  /** 宿主富化字段：该步模型的上下文窗口；未知省略。 */
  contextWindow?: number;
}

/** chat:context 载荷：单会话的计量快照推送。 */
export interface ChatContextUsageEvent {
  sessionId: string;
  snapshot: ChatContextUsageSnapshot;
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
    /** Complete call-phase arguments. */
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
/** 持久化资源：工具调用作用的规范对象。 */
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

// 镜像契约：以下询问卡类型复制自 packages/plugin-ask/src/askUser.ts 的
// AskUser* 纯数据形状（shared 不 import 包），修改任何一侧时必须同步另一侧。
/** 询问卡一个选项（IPC chat:question 载荷）。 */
export interface ChatQuestionOption {
  label: string;
  description?: string;
}

/** 询问卡一个问题（1–4 个/次，选项 1–4 个/题，multiSelect 控制单多选）。 */
export interface ChatQuestionItem {
  question: string;
  header?: string;
  options: ChatQuestionOption[];
  multiSelect?: boolean;
}

/** 询问卡一题的作答：answers 为选中选项 label 或自定义文本。 */
export interface ChatQuestionAnswerItem {
  question: string;
  answers: string[];
}

export interface ChatQuestionEvent {
  sessionId: string;
  messageId: string;
  requestId: string;
  toolName: string;
  questions: ChatQuestionItem[];
}

/** 询问卡应答：answers 与请求的 questions 对齐；null = 用户跳过/取消/会话停止。 */
export type ChatQuestionResponse = { answers: ChatQuestionAnswerItem[] } | null;

/** 询问卡落定通知（chat:question-settled 载荷）：该 requestId 已在主进程了结。 */
export interface ChatQuestionSettledEvent {
  requestId: string;
}

export function isChatQuestionResponse(value: unknown): value is ChatQuestionResponse {
  if (value === null) return true;
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const answers = (value as { answers?: unknown }).answers;
  if (!Array.isArray(answers)) return false;
  return answers.every(
    (item) =>
      !!item &&
      typeof item === "object" &&
      typeof (item as { question?: unknown }).question === "string" &&
      Array.isArray((item as { answers?: unknown }).answers) &&
      (item as { answers: unknown[] }).answers.every((a) => typeof a === "string"),
  );
}

/** One configured platform (preset or custom). */
export interface ProviderProfile {
  apiFormat?: import("@innocenceharness/harness-providers").ApiFormat;
  id: string;
  name: string;
  kind: ProviderKind;
  /** Provider credential as configured by the user. */
  apiKey: string;
  /** Opaque host storage reference; safe to persist and mirror. */
  apiKeyRef?: string;
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
  /** 浅色界面的代码高亮主题（shiki bundled 名）。 */
  codeThemeLight?: string;
  /** 深色界面的代码高亮主题。 */
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
  /** 继承系统终端 Profile（登录环境 + 系统终端字体）；默认开。与 harness-electron 同步。 */
  terminalInheritProfile?: boolean;
  /** 终端字体覆盖；"" = 自动。与 harness-electron 同步。 */
  terminalFontFamily?: string;
  /** 集成终端 shell；默认 "auto"。与 harness-electron 同步。 */
  terminalShell?: "auto" | "cmd" | "powershell" | "gitbash" | "wsl";
  /** 增强 Find/Grep（外部引擎优先，关闭 = 内置扫描）；仅新会话生效，默认开。与 harness-electron 同步。 */
  enhancedFindGrep?: boolean;
  /** 出口流量 HTTP 代理；"" = 直连。重启生效。与 harness-electron 同步。 */
  httpProxy?: string;
  /** 代理绕过主机列表（逗号分隔）。重启生效。与 harness-electron 同步。 */
  proxyBypass?: string;
  /** 自定义 PEM 根证书路径。重启生效。与 harness-electron 同步。 */
  customCaCert?: string;
  /** Chromium 硬件加速；默认开，重启生效。与 harness-electron 同步。 */
  hardwareAcceleration?: boolean;
  /** 预览版更新通道；默认关。与 harness-electron 同步。 */
  previewUpdates?: boolean;
  /** 自动下载更新；默认开。与 harness-electron 同步。 */
  autoDownloadUpdates?: boolean;
  /** 任务桌面通知；默认开。与 harness-electron 同步。 */
  taskNotifications?: boolean;
  /** 任务通知提示音；默认开。与 harness-electron 同步。 */
  notificationSound?: boolean;
  /** 关闭窗口隐藏到托盘（仅 Windows）；默认关。与 harness-electron 同步。 */
  closeToTray?: boolean;
  /** 阻止系统空闲休眠；默认关。与 harness-electron 同步。 */
  keepAwake?: boolean;
  /** 运行中后续消息："queue" 排队（默认）|"steer" 引导运行。与 harness-electron 同步。 */
  interactionMode?: "queue" | "steer";
  /** Agent 提问 5 分钟未答自动继续；默认关。与 harness-electron 同步。 */
  questionAutoContinue?: boolean;
  /** 展示完整思考内容；默认开。与 harness-electron 同步。 */
  showThinking?: boolean;
  /** 展示 Todo 工具卡片；默认开。与 harness-electron 同步。 */
  showTodos?: boolean;
  /** 连续读取/搜索聚合为 Explore 分组；默认开。与 harness-electron 同步。 */
  groupExploreTools?: boolean;
  /** 连续非只读 Shell 聚合为 Terminal 分组；默认开。与 harness-electron 同步。 */
  groupTerminalCommands?: boolean;
  /** 连续 Write/Edit/ApplyPatch 聚合为 Changes 分组；默认关。与 harness-electron 同步。 */
  groupFileChanges?: boolean;
  /** 自动归档过期任务；默认关。与 harness-electron 同步。 */
  autoArchiveTasks?: boolean;
  /** 自动归档保留时长（天；1/3/7/14/30，默认 7）。与 harness-electron 同步。 */
  archiveRetentionDays?: number;
  /** 首次引导完成标记；新装默认 false，旧文件缺失键归一化为 true。与 harness-electron 同步。 */
  onboarded?: boolean;
  /** 体验优化计划授权；默认关。与 harness-electron 同步。 */
  telemetryOptIn?: boolean;
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
  /** 数据存储位置：当前生效数据根与默认根（常规设置页展示）。 */
  getDataRoot(): Promise<{ path: string; defaultPath: string }>;
  /** 目录选择对话框（数据存储位置迁移目标）；取消 → null。 */
  pickDirectory(): Promise<string | null>;
  /** 迁移数据根到 <parentDir>/.innocence 并重启；失败 → ok:false（不重启）。 */
  setDataRoot(parentDir: string): Promise<{ ok: boolean; error?: string }>;
  /** 终端生效字体：显式覆盖优先，其次系统终端探测；无 → null（等宽默认）。 */
  getTerminalFont(): Promise<string | null>;
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
  renameSession(id: string, title: string): Promise<Session>;
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
  /** 上下文容量指示器：主路由计量快照推送（每步一条；切会话回放走查询）。 */
  onChatContextUsage(cb: (e: ChatContextUsageEvent) => void): () => void;
  /** 上下文容量指示器：查询会话当前快照（未水合先惰性水合；无 → null）。 */
  queryContextUsage(sessionId: string): Promise<ChatContextUsageSnapshot | null>;
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
  /** 询问卡（ask_user）：结构化问题推送，按激活会话过滤渲染。 */
  onChatQuestion(cb: (e: ChatQuestionEvent) => void): () => void;
  /** 询问卡作答：answers 与请求问题对齐；null = 用户跳过。 */
  respondChatQuestion(requestId: string, response: ChatQuestionResponse): Promise<void>;
  /** 询问卡落定通知：超时跳过/停止/关机等非渲染层落定广播（清掉对应卡）。 */
  onChatQuestionSettled(cb: (e: ChatQuestionSettledEvent) => void): () => void;
  /** 会话激活时回放：该会话仍挂起的问题卡（切会话回来补卡）。 */
  listPendingQuestions(sessionId: string): Promise<ChatQuestionEvent[]>;
  pickWorkspace(): Promise<string>;
  /** 探测项目根的当前 Git 分支；非 Git 仓库或探测失败返回 null（胶囊隐藏）。 */
  workspaceGitBranch(root: string): Promise<string | null>;
  /** 工作区相对 HEAD 的 diff 概览（更改文件数/增删行 + 暂存/未暂存拆分）；非 Git 或失败返回 null。 */
  workspaceGitChanges(root: string): Promise<{ changedFiles: number; additions: number; deletions: number; stagedFiles: number; unstagedFiles: number } | null>;
  /** 本地分支列表与当前分支；非 Git 仓库或失败返回 null。 */
  workspaceGitBranches(root: string): Promise<{ current: string | null; branches: string[] } | null>;
  /** 切换分支（create=true 时新建并检出）；失败返回 error 摘要。 */
  workspaceGitCheckout(root: string, branch: string, create?: boolean): Promise<{ ok: boolean; branch?: string; error?: string }>;
  /** Git 图谱：全分支拓扑序提交列表（封顶截断）；非 Git 仓库或失败返回 null。 */
  workspaceGitGraph(root: string): Promise<GitGraphData | null>;
  /** 提交更改（stageAll=true 时先暂存全部；message 为空时 AI 生成提交信息）。 */
  workspaceGitCommit(root: string, message: string, stageAll: boolean): Promise<WorkspaceGitActionResult>;
  /** 推送当前分支（无上游时自动 --set-upstream origin HEAD）。 */
  workspaceGitPush(root: string): Promise<WorkspaceGitActionResult>;
  /** AI 生成提交信息（基于 status + diff --stat 摘要；无更改 → 失败结果）。 */
  workspaceGitCommitMessage(root: string): Promise<WorkspaceGitCommitMessageResult>;
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
  /** Applies a settings patch and returns the complete committed settings. */
  setHarnessSettings(settings: HarnessSettingsPatch): Promise<HarnessSettings>;
  /** Stores or clears a provider key and returns the complete settings. */
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
