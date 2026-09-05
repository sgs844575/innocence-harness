// Preload — the only bridge between the sandboxed renderer and the main
// process. Exposes a minimal, typed API surface (contextBridge) with
// sandbox + contextIsolation and no Node in the renderer.
import { contextBridge, ipcRenderer } from "electron";
import { IPC, type AgentModeInfo, type DiscoveredSkillMirror, type InnocenceCodeApi, type SkillInfo, type ThemeMode } from "../shared/ipc";
import {
  TaskIpcChannels,
  type TaskIpcApi,
  type TaskUiEvent,
  type TaskUiNotice,
} from "../shared/taskIpc";
import {
  CodeIpcChannels,
  type CodeIpcApi,
} from "../shared/codeIpc";
import {
  TerminalIpcChannels,
  type TerminalIpcApi,
  type TerminalExitEvent,
  type TerminalOutputEvent,
  type ShellTranscriptEvent,
  type DockTerminalExitEvent,
  type DockTerminalOutputEvent,
} from "../shared/terminalIpc";

function subscribe(channel: string, listener: (...args: never[]) => void): () => void {
  const wrapped = (_e: unknown, ...args: unknown[]) => (listener as (...a: unknown[]) => void)(...args);
  ipcRenderer.on(channel, wrapped as never);
  return () => ipcRenderer.removeListener(channel, wrapped as never);
}

const subscribeTask = <T>(channel: string, cb: (payload: T) => void): (() => void) =>
  subscribe(channel, cb as never);

const api: InnocenceCodeApi = {
  getAppInfo: () => ipcRenderer.invoke(IPC.appInfo),
  getAppMetrics: () => ipcRenderer.invoke(IPC.appMetrics),
  exportLogs: () => ipcRenderer.invoke(IPC.appExportLogs),
  getDataRoot: () => ipcRenderer.invoke(IPC.appGetDataRoot),
  pickDirectory: () => ipcRenderer.invoke(IPC.appPickDirectory),
  setDataRoot: (parentDir) => ipcRenderer.invoke(IPC.appSetDataRoot, parentDir),
  getTerminalFont: () => ipcRenderer.invoke(IPC.terminalResolvedFont),
  getTheme: () => ipcRenderer.invoke(IPC.themeGet),
  setTheme: (mode: ThemeMode) => ipcRenderer.invoke(IPC.themeSet, mode),
  onThemeChanged: (cb) => subscribe(IPC.themeChanged, cb as never),
  minimizeWindow: () => ipcRenderer.invoke(IPC.windowMinimize),
  toggleMaximizeWindow: () => ipcRenderer.invoke(IPC.windowToggleMaximize),
  closeWindow: () => ipcRenderer.invoke(IPC.windowClose),
  isWindowMaximized: () => ipcRenderer.invoke(IPC.windowMaximizedGet),
  onWindowMaximizedChanged: (cb) => subscribe(IPC.windowMaximizedChanged, cb as never),
  listSessions: () => ipcRenderer.invoke(IPC.sessionsList),
  createSession: (options?: { title?: string; workspaceRoot?: string }) =>
    ipcRenderer.invoke(IPC.sessionCreate, options),
  deleteSession: (id) => ipcRenderer.invoke(IPC.sessionDelete, id),
  renameSession: (id, title) => ipcRenderer.invoke(IPC.sessionRename, id, title),
  forkSession: (id, options?: { upToMessageId?: string }) =>
    ipcRenderer.invoke(IPC.sessionFork, id, options),
  startBackgroundJob: (prompt: string, options?: { workspaceRoot?: string }) =>
    ipcRenderer.invoke(IPC.backgroundStart, prompt, options),
  onSessionsChanged: (cb) => subscribe(IPC.sessionsChanged, cb as never),
  getSidebarState: () => ipcRenderer.invoke(IPC.sidebarGet),
  archiveSession: (id, archived) => ipcRenderer.invoke(IPC.sidebarArchive, id, archived),
  pinSession: (id, pinned) => ipcRenderer.invoke(IPC.sidebarPin, id, pinned),
  markSessionUnread: (id, unread) => ipcRenderer.invoke(IPC.sidebarUnread, id, unread),
  reorderSessions: (container, orderedIds) => ipcRenderer.invoke(IPC.sidebarReorder, container, orderedIds),
  moveSession: (id, target, beforeId) => ipcRenderer.invoke(IPC.sidebarMove, id, target, beforeId),
  reorderContainers: (kind, orderedIds) => ipcRenderer.invoke(IPC.sidebarContainersReorder, kind, orderedIds),
  upsertSidebarGroup: (group) => ipcRenderer.invoke(IPC.sidebarGroupUpsert, group),
  deleteSidebarGroup: (id) => ipcRenderer.invoke(IPC.sidebarGroupDelete, id),
  setSidebarGroupCollapsed: (id, collapsed) => ipcRenderer.invoke(IPC.sidebarGroupCollapse, id, collapsed),
  onSidebarChanged: (cb) => subscribe(IPC.sidebarChanged, cb as never),
  listMessages: (sessionId) => ipcRenderer.invoke(IPC.messagesList, sessionId),
  sendMessage: (sessionId, text, userMessageId, attachments) =>
    ipcRenderer.invoke(IPC.chatSend, sessionId, text, userMessageId, attachments),
  resendMessage: (sessionId, fromMessageId, text, newMessageId) =>
    ipcRenderer.invoke(IPC.chatResend, sessionId, fromMessageId, text, newMessageId),
  stopMessage: (sessionId, messageId) => ipcRenderer.invoke(IPC.chatStop, sessionId, messageId),
  onChatDelta: (cb) => subscribe(IPC.chatDelta, cb as never),
  onChatDone: (cb) => subscribe(IPC.chatDone, cb as never),
  onChatContextUsage: (cb) => subscribe(IPC.chatContextUsage, cb as never),
  queryContextUsage: (sessionId) => ipcRenderer.invoke(IPC.contextUsageQuery, sessionId),
  onChatError: (cb) => subscribe(IPC.chatError, cb as never),
  onChatTool: (cb) => subscribe(IPC.chatTool, cb as never),
  onChatThinking: (cb) => subscribe(IPC.chatThinking, cb as never),
  onSubagentLifecycle: (cb) => subscribe(IPC.subagentLifecycle, cb as never),
  listSubagentHistory: (sessionId) => ipcRenderer.invoke(IPC.subagentHistory, sessionId),
  cancelSubagent: (sessionId, childId) => ipcRenderer.invoke(IPC.subagentCancel, sessionId, childId),
  onChatPermission: (cb) => subscribe(IPC.chatPermission, cb as never),
  respondChatPermission: (requestId, choice) =>
    ipcRenderer.invoke(IPC.chatPermissionRespond, requestId, choice),
  onChatQuestion: (cb) => subscribe(IPC.chatQuestion, cb as never),
  respondChatQuestion: (requestId, response) =>
    ipcRenderer.invoke(IPC.chatQuestionRespond, requestId, response),
  onChatQuestionSettled: (cb) => subscribe(IPC.chatQuestionSettled, cb as never),
  listPendingQuestions: (sessionId) =>
    ipcRenderer.invoke(IPC.chatPendingQuestions, sessionId),
  pickWorkspace: () => ipcRenderer.invoke(IPC.workspacePick),
  workspaceGitBranch: (root) => ipcRenderer.invoke(IPC.workspaceGitBranch, root),
  workspaceGitChanges: (root) => ipcRenderer.invoke(IPC.workspaceGitChanges, root),
  workspaceGitBranches: (root) => ipcRenderer.invoke(IPC.workspaceGitBranches, root),
  workspaceGitCheckout: (root, branch, create) =>
    ipcRenderer.invoke(IPC.workspaceGitCheckout, root, branch, create),
  workspaceGitGraph: (root) => ipcRenderer.invoke(IPC.workspaceGitGraph, root),
  workspaceGitCommit: (root, message, stageAll) =>
    ipcRenderer.invoke(IPC.workspaceGitCommit, root, message, stageAll),
  workspaceGitPush: (root) => ipcRenderer.invoke(IPC.workspaceGitPush, root),
  workspaceGitCommitMessage: (root) => ipcRenderer.invoke(IPC.workspaceGitCommitMessage, root),
  listWorkspaceDir: (root, relDir) => ipcRenderer.invoke(IPC.workspaceListDir, root, relDir),
  readWorkspaceFile: (root, rel) => ipcRenderer.invoke(IPC.workspaceReadFile, root, rel),
  listWorkspaceFiles: (root) => ipcRenderer.invoke(IPC.workspaceListFiles, root),
  workspaceGitReviewFiles: (root, scope) =>
    ipcRenderer.invoke(IPC.workspaceGitReviewFiles, root, scope),
  workspaceGitReviewDiff: (root, scope, path) =>
    ipcRenderer.invoke(IPC.workspaceGitReviewDiff, root, scope, path),
  browserEmulate: (request) => ipcRenderer.invoke(IPC.browserEmulate, request),
  revealPath: (path) => ipcRenderer.invoke(IPC.hostRevealPath, path),
  openExternal: (url) => ipcRenderer.invoke(IPC.hostOpenExternal, url),
  getSessionPaths: (id) => ipcRenderer.invoke(IPC.sessionPaths, id),
  getHarnessSettings: () => ipcRenderer.invoke(IPC.settingsGet),
  setHarnessSettings: (settings) => ipcRenderer.invoke(IPC.settingsSet, settings),
  setProviderApiKey: (profileId, apiKey) => ipcRenderer.invoke(IPC.settingsApiKeySet, profileId, apiKey),
  getPluginInventory: () => ipcRenderer.invoke(IPC.pluginsList),
  listAgentModes: (): Promise<AgentModeInfo[]> => ipcRenderer.invoke(IPC.agentsModes),
  listSkills: (root: string): Promise<SkillInfo[]> => ipcRenderer.invoke(IPC.skillsList, root),
  importAttachmentFromPath: (absPath: string) =>
    ipcRenderer.invoke(IPC.attachmentsImportPath, absPath),
  importAttachmentBytes: (name: string, bytes: Uint8Array) =>
    ipcRenderer.invoke(IPC.attachmentsImportBytes, name, bytes),
  generateAutomationCandidate: (prompt) => ipcRenderer.invoke(IPC.automationCandidate, prompt),
  confirmAutomation: (request) => ipcRenderer.invoke(IPC.automationConfirm, request),
  updateAutomation: (request) => ipcRenderer.invoke(IPC.automationUpdate, request),
  deleteAutomation: (id) => ipcRenderer.invoke(IPC.automationDelete, id),
  listAutomations: () => ipcRenderer.invoke(IPC.automationList),
  triggerAutomation: (request) => ipcRenderer.invoke(IPC.automationTrigger, request),
  onPluginsChanged: (cb) => subscribe(IPC.pluginsChanged, cb as never),
  discoverSkills: (): Promise<DiscoveredSkillMirror[]> => ipcRenderer.invoke(IPC.skillsDiscover),
  importSkill: (discovered: DiscoveredSkillMirror) =>
    ipcRenderer.invoke(IPC.skillsImport, discovered),
  importMcpServers: (root, text) => ipcRenderer.invoke(IPC.mcpImport, root, text),
  discoverMcpFile: (root) => ipcRenderer.invoke(IPC.mcpDiscover, root),
  listProviderModels: (profileId) => ipcRenderer.invoke(IPC.settingsModelsList, profileId),
  enrichModels: (providerName, ids) =>
    ipcRenderer.invoke(IPC.settingsEnrichModels, providerName, ids),
  onMenuNewSession: (cb) => subscribe(IPC.uiNewSession, cb as never),
  popupMenu: (id) => ipcRenderer.invoke(IPC.menuPopup, id),
};

/** Task review/route/complete API — narrow subset exposed to the renderer. */
const taskApi: TaskIpcApi = {
  start: (req) => ipcRenderer.invoke(TaskIpcChannels.taskStart, req),
  getTask: (req) => ipcRenderer.invoke(TaskIpcChannels.taskGet, req),
  changes: (req) => ipcRenderer.invoke(TaskIpcChannels.taskChanges, req),
  changeTask: (req) => ipcRenderer.invoke(TaskIpcChannels.taskChange, req),
  checkpoint: (req) => ipcRenderer.invoke(TaskIpcChannels.taskCheckpoint, req),
  review: (req) => ipcRenderer.invoke(TaskIpcChannels.taskReview, req),
  restore: (req) => ipcRenderer.invoke(TaskIpcChannels.taskRestore, req),
  listRoutes: (req) => ipcRenderer.invoke(TaskIpcChannels.taskListRoutes, req),
  switchRoute: (req) => ipcRenderer.invoke(TaskIpcChannels.taskSwitchRoute, req),
  forkRoute: (req) => ipcRenderer.invoke(TaskIpcChannels.taskForkRoute, req),
  editUserMessage: (req) => ipcRenderer.invoke(TaskIpcChannels.taskEditUserMessage, req),
  retryAssistant: (req) => ipcRenderer.invoke(TaskIpcChannels.taskRetryAssistant, req),
  complete: (req) => ipcRenderer.invoke(TaskIpcChannels.taskComplete, req),
  applyAccepted: (req) => ipcRenderer.invoke(TaskIpcChannels.taskApply, req),
  resolveConflict: (req) => ipcRenderer.invoke(TaskIpcChannels.taskResolveConflict, req),
  validate: (req) => ipcRenderer.invoke(TaskIpcChannels.taskValidate, req),
  recoveryWarnings: (req) => ipcRenderer.invoke(TaskIpcChannels.taskRecoveryWarnings, req),
  recoverTask: (req) => ipcRenderer.invoke(TaskIpcChannels.taskRecover, req),
  onTaskEvent: (cb) => subscribeTask<TaskUiEvent>(TaskIpcChannels.taskEvent, cb),
  onTaskNotice: (cb) => subscribeTask<TaskUiNotice>(TaskIpcChannels.taskNotice, cb),
};

/** Read-only code panel API — route-scoped reads/search/external editor. */
const codeApi: CodeIpcApi = {
  readFile: (req) => ipcRenderer.invoke(CodeIpcChannels.codeReadFile, req),
  listFiles: (req) => ipcRenderer.invoke(CodeIpcChannels.codeListFiles, req),
  search: (req) => ipcRenderer.invoke(CodeIpcChannels.codeSearch, req),
  openExternalEditor: (req) => ipcRenderer.invoke(CodeIpcChannels.codeOpenExternalEditor, req),
  notifyFocus: (notice) => {
    ipcRenderer.send(CodeIpcChannels.codeFocusChanged, notice);
  },
};

/** Route-bound terminal API — create/write/resize/dispose + output/exit push. */
const terminalApi: TerminalIpcApi = {
  create: (req) => ipcRenderer.invoke(TerminalIpcChannels.terminalCreate, req),
  write: (req) => ipcRenderer.invoke(TerminalIpcChannels.terminalWrite, req),
  resize: (req) => ipcRenderer.invoke(TerminalIpcChannels.terminalResize, req),
  dispose: (req) => ipcRenderer.invoke(TerminalIpcChannels.terminalDispose, req),
  onTerminalOutput: (cb) => subscribeTask<TerminalOutputEvent>(TerminalIpcChannels.terminalOutput, cb),
  onTerminalExit: (cb) => subscribeTask<TerminalExitEvent>(TerminalIpcChannels.terminalExit, cb),
  onShellTranscript: (cb) => subscribeTask<ShellTranscriptEvent>(TerminalIpcChannels.terminalShell, cb),
  dockCreate: (req) => ipcRenderer.invoke(TerminalIpcChannels.dockTerminalCreate, req),
  dockWrite: (req) => ipcRenderer.invoke(TerminalIpcChannels.dockTerminalWrite, req),
  dockResize: (req) => ipcRenderer.invoke(TerminalIpcChannels.dockTerminalResize, req),
  dockDispose: (req) => ipcRenderer.invoke(TerminalIpcChannels.dockTerminalDispose, req),
  onDockTerminalOutput: (cb) => subscribeTask<DockTerminalOutputEvent>(TerminalIpcChannels.dockTerminalOutput, cb),
  onDockTerminalExit: (cb) => subscribeTask<DockTerminalExitEvent>(TerminalIpcChannels.dockTerminalExit, cb),
};

contextBridge.exposeInMainWorld("innocencecode", api);
contextBridge.exposeInMainWorld("innocencecodeTask", taskApi);
contextBridge.exposeInMainWorld("innocencecodeCode", codeApi);
contextBridge.exposeInMainWorld("innocencecodeTerminal", terminalApi);
