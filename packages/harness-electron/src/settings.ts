// Harness settings v3 — multi-platform provider profiles (Cherry-Studio
// style) with per-model metadata (ModelInfo), persisted by the host. Kept
// free of Electron imports so the runtime stays unit-testable.

import { apiFormatKind, normalizeApiFormat } from "@innocenceharness/harness-providers";
import { modelFromPreset, resolvePresetMeta, type ModelInfo } from "./modelPresets";
import type { PluginToggleSource } from "../../../src/shared/ipc";
import {
  DEFAULT_CODE_THEME_DARK,
  DEFAULT_CODE_THEME_LIGHT,
  normalizeCodeThemeId,
} from "../../../src/shared/codeThemes";

export type { ModelInfo } from "./modelPresets";

/**
 * User-level builtin plugin toggles (the settings face). Open keyspace
 * (manifest-derived): any plugin-id key with a boolean value; the shared/ipc
 * (re-exported here for the T7 type convergence). The four legacy builtin keys stay valid unchanged.
 */
export type { PluginToggleSource } from "../../../src/shared/ipc";

export type ProviderKind = "openai" | "anthropic" | "google";
/** Wire format selected by the provider kind; this is never inferred from a URL. */
export type ProviderProtocol = "openai-compatible" | "anthropic-messages" | "google-generative";

export function providerProtocol(kind: ProviderKind): ProviderProtocol {
  switch (kind) {
    case "openai": return "openai-compatible";
    case "anthropic": return "anthropic-messages";
    case "google": return "google-generative";
  }
}
export type PermissionMode = "auto" | "ask" | "plan" | "full";
export type ThemeMode = "system" | "dark" | "light";
/** "" = follow the system locale. */
export type UiLocale = "zh-CN" | "en-US" | "";

export interface ProviderProfile {
  apiFormat?: import("@innocenceharness/harness-providers").ApiFormat;
  id: string;
  name: string;
  kind: ProviderKind;
  /** Legacy plaintext credential. Old files remain readable; host writes migrate it to apiKeyRef. */
  apiKey: string;
  /** Relative reference to a host-owned secured credential record. */
  apiKeyRef?: string;
  /** Empty = the kind's official default endpoint. */
  baseURL: string;
  enabled: boolean;
  /** User-managed models with metadata (fetched, manual, or preset-enriched). */
  models: ModelInfo[];
  /** True for shipped presets (UI shows them read-only-ish naming). */
  preset?: boolean;
}

export interface HarnessSettings {
  profiles: ProviderProfile[];
  activeProfileId: string; // MOCK_PROFILE_ID or a profile id
  activeModel: string;
  workspaceRoot: string;
  permissionMode: PermissionMode;
  /** UI theme preference; "system" follows nativeTheme. */
  themeMode?: ThemeMode;
  /** 界面字号（px，12..18；缺失/非法回落 14）。渲染层外观，仅持久化不参与会话。 */
  uiFontSize?: number;
  /** 代码字号（px，12..18；缺失/非法回落 14）。代码块/终端/审查 diff 内容用。 */
  codeFontSize?: number;
  /** 浅色界面代码高亮主题（shiki bundled 名）。 */
  codeThemeLight?: string;
  /** 深色界面代码高亮主题。 */
  codeThemeDark?: string;
  /** 代码块行号；缺失默认开。 */
  codeLineNumbers?: boolean;
  /** 代码内容长行自动换行；缺失默认关。 */
  codeWordWrap?: boolean;
  /** Preferred UI language; "" follows the system locale. */
  locale?: UiLocale;
  /** 思考档位（""=跟随模型默认；off/low/medium/high）。 */
  reasoningEffort?: ReasoningEffort;
  /** 当前 agent 模式 id（插件贡献，开放集合）；缺失/非字符串回落 "default"。 */
  activeAgentMode?: string;
  /** 用户级插件开关（四键 subagent/skills/mcp/todo）；缺失键 = 默认开。
   *  项目 .innocence/plugins.yml 优先于此设置（resolvePluginSet 两级覆盖）。 */
  pluginToggles?: PluginToggleSource;
  /** 外部技能目录发现开关；缺失/非法值默认开启。 */
  externalSkillDiscovery?: boolean;
  /** ask 边界 LLM 分类器开关（S3 权限分类器）：true 时静态管线落 ask 前先经
   *  副模型评估（失败/无意见回落用户询问）；默认关闭以省调用费用。 */
  permissionClassifier?: boolean;
  /** 外部编辑器启动命令（Task 11 工作台入口）；"" = 未配置（入口禁用）。
   *  首个 token 可加引号（含空格的路径）；多余 token 作为前置参数透传。 */
  externalEditorCommand?: string;
  /** 继承系统终端 Profile：启动内置终端时继承登录环境与系统终端字体；默认开。 */
  terminalInheritProfile?: boolean;
  /** 终端字体覆盖（CSS font-family 串）；"" = 自动（继承系统终端或等宽默认）。 */
  terminalFontFamily?: string;
  /** 集成终端 shell（Windows 下 Bash 工具同用）；默认 "auto"（优先 Git Bash，回退 cmd）。 */
  terminalShell?: TerminalShell;
  /** 增强 Find/Grep 工具开关（优先 ripgrep 系外部引擎，关闭 = 内置扫描）；
   *  仅新会话生效，默认开。 */
  enhancedFindGrep?: boolean;
  /** 出口流量 HTTP 代理 URL；"" = 直连（渲染层跟随系统代理）。重启生效。 */
  httpProxy?: string;
  /** 代理绕过主机列表（英文逗号分隔）；重启生效。 */
  proxyBypass?: string;
  /** 自定义 PEM 根证书路径（NODE_EXTRA_CA_CERTS 注入 + 渲染层校验）；重启生效。 */
  customCaCert?: string;
  /** Chromium 硬件加速；默认开，关闭需重启生效。 */
  hardwareAcceleration?: boolean;
  /** 接受预览版更新通道；默认关。（更新器落地前仅持久化偏好。） */
  previewUpdates?: boolean;
  /** 检测到更新后自动下载；默认开。（更新器落地前仅持久化偏好。） */
  autoDownloadUpdates?: boolean;
  /** 任务完成/失败/待确认时发送桌面通知；默认开。 */
  taskNotifications?: boolean;
  /** 任务通知提示音；默认开（关闭 = 静默通知）。 */
  notificationSound?: boolean;
  /** 关闭窗口时隐藏到托盘（仅 Windows）；默认关。 */
  closeToTray?: boolean;
  /** 阻止系统空闲休眠（powerSaveBlocker）；默认关。 */
  keepAwake?: boolean;
  /** 运行中发送后续消息的行为："queue" 排队（默认）|"steer" 引导至下一轮工具调用后运行。 */
  interactionMode?: InteractionMode;
  /** Agent 提问 5 分钟未回答自动继续；默认关（一直等待）。 */
  questionAutoContinue?: boolean;
  /** 消息流展示完整思考内容；默认开（关闭时每轮仍展示第一次思考）。 */
  showThinking?: boolean;
  /** 消息流展示 Todo 工具卡片；默认开。 */
  showTodos?: boolean;
  /** 连续读取/搜索工具聚合为 Explore 分组；默认开。 */
  groupExploreTools?: boolean;
  /** 连续非只读 Shell 命令聚合为 Terminal 分组；默认开。 */
  groupTerminalCommands?: boolean;
  /** 连续 Write/Edit/ApplyPatch 聚合为 Changes 分组；默认关。 */
  groupFileChanges?: boolean;
  /** 定时自动归档已完成、无未读、未置顶且超过保留期的任务；默认关。 */
  autoArchiveTasks?: boolean;
  /** 自动归档保留时长（天；1/3/7/14/30，默认 7）。 */
  archiveRetentionDays?: number;
  /** 首次引导完成标记。出厂默认 false（新装弹引导）；旧设置文件缺失该键
   *  归一化为 true（老用户不打扰）。 */
  onboarded?: boolean;
  /** 体验优化计划（对话内容回传授权）；默认关。 */
  telemetryOptIn?: boolean;
}

/** 集成终端 shell 候选；"auto" = Windows 优先 Git Bash 回退 cmd，POSIX 用 $SHELL。 */
export type TerminalShell = "auto" | "cmd" | "powershell" | "gitbash" | "wsl";
export const TERMINAL_SHELLS: TerminalShell[] = ["auto", "cmd", "powershell", "gitbash", "wsl"];
/** 运行中发送后续消息的交互行为。 */
export type InteractionMode = "queue" | "steer";
/** 自动归档保留时长候选（天）。 */
export const ARCHIVE_RETENTION_DAYS: number[] = [1, 3, 7, 14, 30];

function normalizeExternalSkillDiscovery(raw: unknown): boolean {
  return raw !== false;
}

function normalizeExternalEditorCommand(raw: unknown): string {
  return typeof raw === "string" ? raw : "";
}

/** 思考档位全集；空串 = 不带参数（跟随模型默认）。max 透传给支持的端点
 *  （GLM 系"最高"），Anthropic 映射最大预算。 */
export type ReasoningEffort = "" | "off" | "low" | "medium" | "high" | "max";

export const REASONING_EFFORTS: ReasoningEffort[] = ["", "off", "low", "medium", "high", "max"];

function normalizeReasoningEffort(raw: unknown): ReasoningEffort {
  return REASONING_EFFORTS.includes(raw as ReasoningEffort) ? (raw as ReasoningEffort) : "";
}

function normalizeActiveAgentMode(raw: unknown): string {
  return typeof raw === "string" && raw.length > 0 ? raw : "default";
}

/** 布尔归一化：缺失/非法回落给定默认（常规页功能项的默认有开有关）。 */
function boolOr(raw: unknown, fallback: boolean): boolean {
  return typeof raw === "boolean" ? raw : fallback;
}

/** 字符串归一化：非字符串回落 ""。 */
function stringOrEmpty(raw: unknown): string {
  return typeof raw === "string" ? raw : "";
}

function normalizeTerminalShell(raw: unknown): TerminalShell {
  return TERMINAL_SHELLS.includes(raw as TerminalShell) ? (raw as TerminalShell) : "auto";
}

function normalizeInteractionMode(raw: unknown): InteractionMode {
  return raw === "steer" ? "steer" : "queue";
}

function normalizeArchiveRetentionDays(raw: unknown): number {
  return typeof raw === "number" && ARCHIVE_RETENTION_DAYS.includes(raw) ? raw : 7;
}

/** 常规设置页功能项的统一归一化（v1 迁移/无 profiles 缺省/v3 全量三个分支
 *  共用）。onboarded 语义特殊：键缺失 = 老用户 = true；出厂 false 只来自
 *  DEFAULT_SETTINGS（无设置文件的新装）。 */
function mergeGeneralFeatures(src: Partial<HarnessSettings>): Partial<HarnessSettings> {
  return {
    terminalInheritProfile: boolOr(src.terminalInheritProfile, true),
    terminalFontFamily: stringOrEmpty(src.terminalFontFamily),
    terminalShell: normalizeTerminalShell(src.terminalShell),
    enhancedFindGrep: boolOr(src.enhancedFindGrep, true),
    httpProxy: stringOrEmpty(src.httpProxy),
    proxyBypass: stringOrEmpty(src.proxyBypass),
    customCaCert: stringOrEmpty(src.customCaCert),
    hardwareAcceleration: boolOr(src.hardwareAcceleration, true),
    previewUpdates: boolOr(src.previewUpdates, false),
    autoDownloadUpdates: boolOr(src.autoDownloadUpdates, true),
    taskNotifications: boolOr(src.taskNotifications, true),
    notificationSound: boolOr(src.notificationSound, true),
    closeToTray: boolOr(src.closeToTray, false),
    keepAwake: boolOr(src.keepAwake, false),
    interactionMode: normalizeInteractionMode(src.interactionMode),
    questionAutoContinue: boolOr(src.questionAutoContinue, false),
    showThinking: boolOr(src.showThinking, true),
    showTodos: boolOr(src.showTodos, true),
    groupExploreTools: boolOr(src.groupExploreTools, true),
    groupTerminalCommands: boolOr(src.groupTerminalCommands, true),
    groupFileChanges: boolOr(src.groupFileChanges, false),
    autoArchiveTasks: boolOr(src.autoArchiveTasks, false),
    archiveRetentionDays: normalizeArchiveRetentionDays(src.archiveRetentionDays),
    onboarded: src.onboarded !== false,
    telemetryOptIn: boolOr(src.telemetryOptIn, false),
  };
}

/** 界面/代码字号收窄区间（px）与默认值；normalizeFontSize 共用。 */
export const FONT_SIZE_MIN = 12;
export const FONT_SIZE_MAX = 18;
export const FONT_SIZE_DEFAULT = 14;

/** Built-in offline profile — always available, models: ["mock"]. */
export const MOCK_PROFILE_ID = "__mock__";
export const MOCK_MODEL = "mock";

export interface ProviderPreset {
  name: string;
  kind: ProviderKind;
  baseURL: string;
  models: string[];
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
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

function presetProfile(preset: ProviderPreset): ProviderProfile {
  return {
    id: `preset_${preset.name}`,
    name: preset.name,
    kind: preset.kind,
    apiKey: "",
    baseURL: preset.baseURL,
    enabled: false,
    models: preset.models.map((m) => modelFromPreset(preset.name, m)),
    preset: true,
  };
}

/** 常规设置页功能项的出厂默认（新装 = 未引导 onboarded:false；
 *  旧文件缺失键的归一化语义见 mergeSettings 各 normalize 调用）。 */
export const GENERAL_FEATURE_DEFAULTS = {
  terminalInheritProfile: true,
  terminalFontFamily: "",
  terminalShell: "auto",
  enhancedFindGrep: true,
  httpProxy: "",
  proxyBypass: "",
  customCaCert: "",
  hardwareAcceleration: true,
  previewUpdates: false,
  autoDownloadUpdates: true,
  taskNotifications: true,
  notificationSound: true,
  closeToTray: false,
  keepAwake: false,
  interactionMode: "queue",
  questionAutoContinue: false,
  showThinking: true,
  showTodos: true,
  groupExploreTools: true,
  groupTerminalCommands: true,
  groupFileChanges: false,
  autoArchiveTasks: false,
  archiveRetentionDays: 7,
  onboarded: false,
  telemetryOptIn: false,
} as const satisfies Partial<HarnessSettings>;

export const DEFAULT_SETTINGS: HarnessSettings = {
  profiles: PROVIDER_PRESETS.map(presetProfile),
  activeProfileId: MOCK_PROFILE_ID,
  activeModel: MOCK_MODEL,
  workspaceRoot: "",
  permissionMode: "ask",
  themeMode: "system",
  locale: "",
  uiFontSize: FONT_SIZE_DEFAULT,
  codeFontSize: FONT_SIZE_DEFAULT,
  codeThemeLight: DEFAULT_CODE_THEME_LIGHT,
  codeThemeDark: DEFAULT_CODE_THEME_DARK,
  codeLineNumbers: true,
  codeWordWrap: false,
  reasoningEffort: "",
  activeAgentMode: "default",
  externalSkillDiscovery: true,
  permissionClassifier: false,
  externalEditorCommand: "",
  ...GENERAL_FEATURE_DEFAULTS,
};

let customSeq = 0;
export const newProfileId = () =>
  `custom_${Date.now().toString(36)}_${(customSeq++).toString(36)}`;

export function newCustomProfile(name = "自定义平台"): ProviderProfile {
  return {
    id: newProfileId(),
    name,
    kind: "openai",
    apiKey: "",
    baseURL: "",
    enabled: true,
    models: [],
    preset: false,
  };
}

/** Normalizes one model entry: v2 strings migrate (preset-hit enriches,
 *  anything else is manual), v3 objects keep their fields as-is. */
function normalizeModel(raw: unknown, providerName: string): ModelInfo | null {
  if (typeof raw === "string" && raw.length > 0) {
    // v2 迁移：预设命中记 preset 并 enrich 元数据，否则记 manual（用户自己加过的）。
    const meta = resolvePresetMeta(providerName, raw);
    return meta ? { id: raw, source: "preset", ...meta } : { id: raw, source: "manual" };
  }
  if (typeof raw !== "object" || raw === null) return null;
  const src = raw as Partial<ModelInfo>;
  if (typeof src.id !== "string" || !src.id) return null;
  const num = (v: unknown) => (typeof v === "number" && v > 0 ? v : undefined);
  return {
    id: src.id,
    name: typeof src.name === "string" && src.name ? src.name : undefined,
    group: typeof src.group === "string" && src.group ? src.group : undefined,
    contextWindow: num(src.contextWindow),
    maxInput: num(src.maxInput),
    maxOutput: num(src.maxOutput),
    vision: src.vision === true || undefined,
    video: src.video === true || undefined,
    tools: src.tools === true || undefined,
    reasoning: src.reasoning === true || undefined,
    streaming: src.streaming === false ? false : undefined,
    source: src.source === "fetch" || src.source === "manual" ? src.source : "preset",
    dirty: src.dirty === true || undefined,
  };
}

function normalizeProfile(raw: unknown): ProviderProfile | null {
  if (typeof raw !== "object" || raw === null) return null;
  const src = raw as Partial<ProviderProfile>;
  if (typeof src.id !== "string" || !src.id) return null;
  return {
    id: src.id,
    ...(normalizeApiFormat(src.apiFormat) ? { apiFormat: normalizeApiFormat(src.apiFormat) } : {}),
    name: typeof src.name === "string" && src.name ? src.name : src.id,
    kind: src.kind === "anthropic" || src.kind === "google" ? src.kind : "openai",
    apiKey: typeof src.apiKey === "string" ? src.apiKey : "",
    apiKeyRef: typeof src.apiKeyRef === "string" && src.apiKeyRef ? src.apiKeyRef : undefined,
    baseURL: typeof src.baseURL === "string" ? src.baseURL : "",
    enabled: src.enabled === true,
    models: Array.isArray(src.models)
      ? src.models
          .map((m) => normalizeModel(m, src.name ?? ""))
          .filter((m): m is ModelInfo => m !== null)
      : [],
    preset: src.preset === true,
  };
}

function normalizeThemeMode(raw: unknown): ThemeMode {
  return raw === "dark" || raw === "light" ? raw : "system";
}

function normalizePermissionMode(raw: unknown): PermissionMode {
  return raw === "auto" || raw === "plan" || raw === "full" ? raw : "ask";
}

function normalizeLocale(raw: unknown): UiLocale {
  return raw === "zh-CN" || raw === "en-US" ? raw : "";
}

/** 界面/代码字号归一化：整数 12..18 收窄，缺失/非法回落 14。 */
function normalizeFontSize(raw: unknown): number {
  return typeof raw === "number" && Number.isFinite(raw)
    ? Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, Math.round(raw)))
    : FONT_SIZE_DEFAULT;
}

/** 布尔值键保留、非布尔剔除；无有效键回落 undefined（undefined = 默认全开，
 *  与 resolvePluginSet 的两级覆盖语义一致）。键空间开放（清单派生）：任意
 *  插件 id 键均透传——写路径不再静默剔除清单内插件（如 example）的开关，
 *  cordis.yml 键在 settings 未保存该键时仍生效（settings 按键覆盖文件）。 */
function normalizePluginToggles(raw: unknown): PluginToggleSource | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const src = raw as Record<string, unknown>;
  const out: Record<string, boolean> = {};
  let hasAny = false;
  for (const [key, value] of Object.entries(src)) {
    if (typeof value === "boolean") {
      out[key] = value;
      hasAny = true;
    }
  }
  return hasAny ? out : undefined;
}

/** v1 (single-provider) shape, for migration. */
interface SettingsV1 {
  providerId?: string;
  openai?: { apiKey?: string; baseURL?: string; model?: string };
  anthropic?: { apiKey?: string; model?: string };
  workspaceRoot?: string;
  permissionMode?: string;
}

function migrateFromV1(v1: SettingsV1): HarnessSettings {
  const profiles: ProviderProfile[] = [];
  if (v1.openai?.apiKey) {
    profiles.push({
      id: "preset_OpenAI",
      name: "OpenAI",
      kind: "openai",
      apiKey: v1.openai.apiKey,
      baseURL: v1.openai.baseURL ?? "",
      enabled: true,
      models: [modelFromPreset("OpenAI", v1.openai.model ?? "gpt-4o")],
      preset: true,
    });
  }
  if (v1.anthropic?.apiKey) {
    profiles.push({
      id: "preset_Anthropic",
      name: "Anthropic",
      kind: "anthropic",
      apiKey: v1.anthropic.apiKey,
      baseURL: "",
      enabled: true,
      models: [modelFromPreset("Anthropic", v1.anthropic.model ?? "claude-sonnet-4-5")],
      preset: true,
    });
  }
  // Bring in every preset the migration did not cover (deep-copy models).
  for (const preset of PROVIDER_PRESETS) {
    if (!profiles.some((p) => p.name === preset.name)) {
      profiles.push(presetProfile(preset));
    }
  }
  let activeProfileId = MOCK_PROFILE_ID;
  let activeModel = MOCK_MODEL;
  if (v1.providerId === "openai") {
    const p = profiles.find((x) => x.kind === "openai" && x.enabled);
    if (p) {
      activeProfileId = p.id;
      activeModel = p.models[0]?.id ?? MOCK_MODEL;
    }
  } else if (v1.providerId === "anthropic") {
    const p = profiles.find((x) => x.kind === "anthropic" && x.enabled);
    if (p) {
      activeProfileId = p.id;
      activeModel = p.models[0]?.id ?? MOCK_MODEL;
    }
  }
  return {
    profiles,
    activeProfileId,
    activeModel,
    workspaceRoot: typeof v1.workspaceRoot === "string" ? v1.workspaceRoot : "",
    permissionMode: normalizePermissionMode(v1.permissionMode),
    themeMode: normalizeThemeMode((v1 as { themeMode?: unknown }).themeMode),
    locale: normalizeLocale((v1 as { locale?: unknown }).locale),
    reasoningEffort: normalizeReasoningEffort((v1 as { reasoningEffort?: unknown }).reasoningEffort),
    activeAgentMode: normalizeActiveAgentMode((v1 as { activeAgentMode?: unknown }).activeAgentMode),
    externalSkillDiscovery: normalizeExternalSkillDiscovery((v1 as { externalSkillDiscovery?: unknown }).externalSkillDiscovery),
    // pluginToggles：v1 不可能含该键，有意不透传（缺省 = 默认全开）。
    codeThemeLight: DEFAULT_CODE_THEME_LIGHT,
    codeThemeDark: DEFAULT_CODE_THEME_DARK,
    codeLineNumbers: true,
    codeWordWrap: false,
    ...mergeGeneralFeatures(v1 as Partial<HarnessSettings>),
  };
}

/**
 * Defensive merge/normalize for settings loaded from disk:
 * accepts v2/v3 (profiles[]) — v2 string models migrate to ModelInfo —
 * and migrates v1 (providerId/openai/anthropic).
 */
export function mergeSettings(raw: unknown): HarnessSettings {
  if (typeof raw !== "object" || raw === null) return DEFAULT_SETTINGS;
  const src = raw as Partial<HarnessSettings> & SettingsV1;
  if (!Array.isArray(src.profiles)) {
    if (src.providerId || src.openai || src.anthropic) return migrateFromV1(src);
    return { ...DEFAULT_SETTINGS, workspaceRoot: src.workspaceRoot ?? "",
      permissionMode: normalizePermissionMode(src.permissionMode),
      themeMode: normalizeThemeMode(src.themeMode), locale: normalizeLocale(src.locale),
      uiFontSize: normalizeFontSize(src.uiFontSize), codeFontSize: normalizeFontSize(src.codeFontSize),
      codeThemeLight: normalizeCodeThemeId(src.codeThemeLight, DEFAULT_CODE_THEME_LIGHT),
      codeThemeDark: normalizeCodeThemeId(src.codeThemeDark, DEFAULT_CODE_THEME_DARK),
      codeLineNumbers: src.codeLineNumbers !== false,
      codeWordWrap: src.codeWordWrap === true,
      reasoningEffort: normalizeReasoningEffort(src.reasoningEffort),
      activeAgentMode: normalizeActiveAgentMode(src.activeAgentMode),
      externalSkillDiscovery: normalizeExternalSkillDiscovery(src.externalSkillDiscovery),
      permissionClassifier: src.permissionClassifier === true,
      pluginToggles: normalizePluginToggles(src.pluginToggles),
      externalEditorCommand: normalizeExternalEditorCommand(src.externalEditorCommand),
      ...mergeGeneralFeatures(src) };
  }

  const profiles = src.profiles
    .map(normalizeProfile)
    .filter((p): p is ProviderProfile => p !== null);
  const active = profiles.find((p) => p.id === src.activeProfileId && p.enabled);
  return {
    profiles,
    activeProfileId: active?.id ?? MOCK_PROFILE_ID,
    activeModel:
      active && typeof src.activeModel === "string" && active.models.some((m) => m.id === src.activeModel)
        ? src.activeModel
        : (active?.models[0]?.id ?? MOCK_MODEL),
    workspaceRoot: typeof src.workspaceRoot === "string" ? src.workspaceRoot : "",
    permissionMode: normalizePermissionMode(src.permissionMode),
    themeMode: normalizeThemeMode(src.themeMode),
    locale: normalizeLocale(src.locale),
    uiFontSize: normalizeFontSize(src.uiFontSize),
    codeFontSize: normalizeFontSize(src.codeFontSize),
    codeThemeLight: normalizeCodeThemeId(src.codeThemeLight, DEFAULT_CODE_THEME_LIGHT),
    codeThemeDark: normalizeCodeThemeId(src.codeThemeDark, DEFAULT_CODE_THEME_DARK),
    codeLineNumbers: src.codeLineNumbers !== false,
    codeWordWrap: src.codeWordWrap === true,
    reasoningEffort: normalizeReasoningEffort(src.reasoningEffort),
    activeAgentMode: normalizeActiveAgentMode(src.activeAgentMode),
    externalSkillDiscovery: normalizeExternalSkillDiscovery(src.externalSkillDiscovery),
    permissionClassifier: src.permissionClassifier === true,
    pluginToggles: normalizePluginToggles(src.pluginToggles),
    externalEditorCommand: normalizeExternalEditorCommand(src.externalEditorCommand),
    ...mergeGeneralFeatures(src),
  };
}

export type ActiveResolution =
  | { kind: "mock" }
  | { kind: ProviderKind; apiKey: string; baseURL: string; model: string };

/** Resolves the currently selected provider+model, falling back to mock. */
export function resolveActive(settings: HarnessSettings): ActiveResolution {
  const profile = settings.profiles.find(
    (p) => p.id === settings.activeProfileId && p.enabled,
  );
  if (!profile || !profile.apiKey.trim() || !profile.models.some((m) => m.id === settings.activeModel)) {
    return { kind: "mock" };
  }
  return {
    kind: apiFormatKind(profile),
    apiKey: profile.apiKey,
    baseURL: profile.baseURL,
    model: settings.activeModel,
  };
}

/** Fetches a platform's model id list from its protocol-specific endpoint. */
export async function listModels(
  profile: Pick<ProviderProfile, "kind" | "apiKey" | "baseURL" | "apiFormat">,
  fetchImpl: typeof fetch = fetch,
): Promise<string[]> {
  const { apiKey, baseURL } = profile;
  const kind = apiFormatKind(profile);
  if (kind !== "openai" && kind !== "anthropic" && kind !== "google") {
    throw new Error("unsupported provider kind");
  }
  const defaults: Record<ProviderKind, string> = {
    openai: "https://api.openai.com/v1",
    anthropic: "https://api.anthropic.com",
    google: "https://generativelanguage.googleapis.com/v1beta",
  };
  const base = (baseURL || defaults[kind]).replace(/\/+$/, "");
  const url = kind === "anthropic" ? `${base.replace(/\/v1$/, "")}/v1/models` : `${base}/models`;
  const headers: Record<string, string> =
    kind === "anthropic"
      ? { "x-api-key": apiKey, "anthropic-version": "2023-06-01" }
      : kind === "google"
        ? { "x-goog-api-key": apiKey }
        : { authorization: `Bearer ${apiKey}` };
  const res = await fetchImpl(url, { headers });
  if (!res.ok) {
    throw new Error(`获取模型列表失败 HTTP ${res.status}`);
  }
  const json = (await res.json()) as {
    data?: Array<{ id?: string; name?: string; display_name?: string }>;
    models?: Array<{ name?: string; displayName?: string }>;
  };
  const ids = kind === "google"
    ? (json.models ?? [])
        .map((model) => model.name)
        .filter((id): id is string => typeof id === "string" && id.length > 0)
        .map((id) => id.replace(/^models\//, ""))
    : (json.data ?? [])
        .map((model) => model.id ?? model.name)
        .filter((id): id is string => typeof id === "string" && id.length > 0);
  return [...new Set(ids)];
}

export const MOCK_GREETING =
  "当前是本地 Mock 模型（未配置真实 API）。我只会原样回复，不会调用工具。\n\n" +
  "在设置（左下角齿轮）里选择一个平台、填入 API Key、选择模型后，我才能真正干活。";
