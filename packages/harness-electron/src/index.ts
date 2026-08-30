export {
  DEFAULT_SETTINGS,
  MOCK_GREETING,
  MOCK_MODEL,
  MOCK_PROFILE_ID,
  PROVIDER_PRESETS,
  listModels,
  mergeSettings,
  newCustomProfile,
  newProfileId,
  resolveActive,
  type ActiveResolution,
  type HarnessSettings,
  type PermissionMode,
  type PluginToggleSource,
  type ProviderKind,
  type ProviderProtocol,
  type ProviderPreset,
  type ProviderProfile,
  providerProtocol,
} from "./settings";
export { BUILTIN_FALLBACK_PROMPT } from "./agents";
export {
  HarnessRuntime,
  IN_FLIGHT_BUILD_DISPOSE_TIMEOUT_MS,
  DEFAULT_ROUTE_ID,
  routeCacheKey,
  type AskResponse,
  type LiveToolPart,
  type PermissionAsk,
  type PluginFactoryContext,
  type RuntimeHooks,
  type RuntimeOptions,
  type RuntimeSendRequest,
  type SessionToolIndex,
} from "./runtime";
export {
  createTraceAdapter,
  type TraceAdapter,
} from "@innocenceharness/harness-ai-runtime";
export { modelFromPreset, resolvePresetMeta, type PresetModelMeta } from "./modelPresets";
// S3 权限分类器宿主适配器（ask 边界评估轮：超时/签名缓存/fail-closed）。
export {
  createPermissionClassifier,
  type PermissionClassifierOptions,
} from "./permission-classifier";
// S2a 工作树会话隔离纪律片段（组合根与子代理工厂共用一个来源）。
export { WORKTREE_ISOLATION_FRAGMENT } from "./worktree-fragment";
export {
  canonicalizeHistory,
  decodeTranscript,
  encodeTurnV2,
  encodeTurnV3,
  type DecodedMessage,
  type DecodedTranscript,
  type TranscriptRoute,
  type TurnRecordV2,
  type TurnRecordV3,
  type TurnRecordV3Input,
} from "./transcript";
// Session family (moved here when the retired core package was deleted):
// the conversational AgentSession, its kernel composition, the legacy
// plugin-registration face and the compat view over the spine services.
export { AgentSession, type AgentSessionOptions, type RunSummary } from "./session";
export { staticSpineSuite, type SessionSpineSuite } from "./session-spine";
export { type SessionLoaderPlugin } from "./session-loader";
export {
  PluginRegistry,
  TOOL_PERSISTENCY_POLICY_REQUIRED,
  ToolPersistenceError,
  type HarnessPlugin,
  type LogLevel,
  type Logger,
  type PluginContext,
  type SessionPlugin,
} from "./registry";
