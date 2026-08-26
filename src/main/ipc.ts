// IPC surface — one handler per channel defined in src/shared/ipc.ts.
import { app, ipcMain } from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import { IPC, type MenuId } from "../shared/ipc";
import { modelFromPreset, resolvePresetMeta } from "@innocenceharness/harness-electron";
import { discoverExternalSkills, importSkill, type DiscoveredSkill } from "./skillDiscovery";
import { discoverMcpFile, importMcpServers, parseMcpImport } from "./mcpImport";
import { authorizeWorkspaceRoot } from "./mcpAuthorization";
import { TaskIpcChannels } from "../shared/taskIpc";
import { broadcastTheme, getTheme, setTheme } from "./theme";
import * as sessions from "./sessions";
import {
  getCommittedHarnessSettings,
  getHarnessSettings,
  getPluginInventory,
  listProviderModelsById,
  pickWorkspace,
  respondPermission,
  sendChatTurn,
  setHarnessSettings,
  stopChatTurn,
  updateProviderApiKey,
  disposeSession,
} from "./harnessGlue";
import type { HarnessSettingsPatch } from "../shared/settingsPatch";
import { popupMenu } from "./menu";
import { getMainWindow } from "./appWindow";
import { logger } from "./logger";
import { broadcastSessions, broadcastSidebar } from "./sessionEvents";
import { TaskIpcHandlers } from "./taskIpcHandlers";

/** Task IPC handlers — wired by registerTaskIpcHandlers after bridge composition. */
let taskHandlers: TaskIpcHandlers | undefined;

/**
 * Wires task IPC handlers after the TaskRuntimeBridge is created.
 * Called from the host composition root (harnessGlue / index.ts).
 */
export function registerTaskIpcHandlers(handlers: TaskIpcHandlers): void {
  taskHandlers = handlers;
}

function requireTaskHandlers(): TaskIpcHandlers {
  if (!taskHandlers) throw new Error("task bridge not wired yet");
  return taskHandlers;
}

export function registerIpcHandlers(): void {
  const needWindow = () => {
    const w = getMainWindow();
    if (!w) throw new Error("main window not ready");
    return w;
  };

  ipcMain.handle(IPC.appInfo, () => ({
    version: app.getVersion(),
    platform: process.platform,
    locale: app.getLocale(),
  }));

  ipcMain.handle(IPC.themeGet, () => getTheme());
  ipcMain.handle(IPC.themeSet, (_e, mode) => {
    setTheme(mode);
    broadcastTheme(needWindow());
  });

  ipcMain.handle(IPC.sessionsList, () => sessions.listSessions());
  ipcMain.handle(IPC.sidebarGet, () => sessions.getSidebarState());
  ipcMain.handle(IPC.sidebarArchive, (_e, id: string, archived: boolean) => {
    sessions.archiveSession(id, archived);
    broadcastSidebar();
  });
  ipcMain.handle(IPC.sidebarReorder, (_e, container, orderedIds: string[]) => {
    sessions.reorderSessions(container, orderedIds);
    broadcastSidebar();
  });
  ipcMain.handle(IPC.sidebarMove, (_e, id: string, target, beforeId?: string) => {
    sessions.moveSession(id, target, beforeId);
    broadcastSidebar();
  });
  ipcMain.handle(IPC.sidebarContainersReorder, (_e, kind: "projects" | "groups", orderedIds: string[]) => {
    sessions.reorderSidebarContainers(kind, orderedIds);
    broadcastSidebar();
  });
  ipcMain.handle(IPC.sidebarGroupUpsert, (_e, group) => {
    sessions.upsertSidebarGroup(group);
    broadcastSidebar();
  });
  ipcMain.handle(IPC.sidebarGroupDelete, (_e, id: string) => {
    sessions.deleteSidebarGroup(id);
    broadcastSidebar();
  });
  ipcMain.handle(IPC.sidebarGroupCollapse, (_e, id: string, collapsed: boolean) => {
    sessions.setSidebarGroupCollapsed(id, collapsed);
    broadcastSidebar();
  });
  ipcMain.handle(IPC.sessionCreate, (_e, options?: { title?: string; workspaceRoot?: string }) => {
    const session = sessions.createSession({ title: options?.title, workspaceRoot: options?.workspaceRoot });
    broadcastSessions();
    broadcastSidebar();
    return session;
  });
  ipcMain.handle(IPC.sessionDelete, async (_e, id: string) => {
    // Stop first, then AWAIT resource release before unlinking the session
    // index/transcript: MCP child processes are gone when the delete
    // resolves, and dispose's bounded build-wait keeps this from ever
    // hanging. The turn's final persist is NOT guaranteed to land before
    // the files disappear: dispose waits the active run, but the
    // fire-and-forget runtime.send tail (persistTurn after run settles)
    // can still write afterwards — a known, harmless orphan transcript.
    stopChatTurn(id);
    await disposeSession(id);
    sessions.deleteSession(id);
    broadcastSessions();
    broadcastSidebar();
  });
  ipcMain.handle(IPC.messagesList, (_e, sessionId: string) => sessions.listMessages(sessionId));

  ipcMain.handle(IPC.chatSend, (_e, sessionId: string, text: string) => {
    needWindow();
    const trimmed = text.trim();
    if (!trimmed) throw new Error("empty message");
    sessions.appendMessage(sessionId, {
      id: `msg_${Date.now().toString(36)}_u`,
      role: "user",
      parts: [{ type: "text", text: trimmed }],
      createdAt: Date.now(),
    });
    // First user message retitles + reorders the session — push immediately so
    // the sidebar shows it before the stream completes.
    broadcastSessions();
    broadcastSidebar();
    const messageId = sendChatTurn(sessionId, trimmed);
    logger.info("chat:send", { sessionId, messageId });
    return { messageId };
  });

  ipcMain.handle(IPC.chatStop, (_e, sessionId: string) => {
    stopChatTurn(sessionId);
  });

  ipcMain.handle(IPC.chatPermissionRespond, (_e, requestId: string, choice: string) => {
    if (choice === "allow" || choice === "allowSession" || choice === "deny") {
      respondPermission(requestId, choice);
    }
  });

  ipcMain.handle(IPC.workspacePick, () => pickWorkspace());

  ipcMain.handle(IPC.settingsGet, () => getCommittedHarnessSettings());
  ipcMain.handle(IPC.settingsSet, (_e, next: HarnessSettingsPatch) => setHarnessSettings(next));
  ipcMain.handle(IPC.settingsApiKeySet, (_e, profileId: string, apiKey: string) =>
    updateProviderApiKey(profileId, apiKey),
  );
  // 插件清单投影：main 按当前 toggles 现算（无 boot 时阻塞到 boot 完成）。
  ipcMain.handle(IPC.pluginsList, () => getPluginInventory());
  // 技能发现/导入：main 直连 discovery 模块（无会话状态，无需 boot）。
  ipcMain.handle(IPC.skillsDiscover, () =>
    getHarnessSettings().externalSkillDiscovery === false ? [] : discoverExternalSkills(),
  );
  ipcMain.handle(IPC.skillsImport, (_e, discovered: DiscoveredSkill) => {
    if (getHarnessSettings().externalSkillDiscovery === false) {
      throw new Error("external skill discovery is disabled");
    }
    return importSkill(discovered);
  });
  // MCP 标准格式导入：解析在 main 侧。text 非空 = 显式内容；text 为空 =
  // 渲染层无文件读权，main 代读 <root>/.mcp.json（发现文件一键导入流）。
  ipcMain.handle(IPC.mcpImport, async (_e, root: string, text: string) => {
    const authorizedRoot = await authorizeWorkspaceRoot(root, getHarnessSettings().workspaceRoot);
    const content = text || await fs.readFile(path.join(authorizedRoot, ".mcp.json"), "utf8");
    const parsed = parseMcpImport(content);
    return importMcpServers(parsed.servers, authorizedRoot, parsed.invalid);
  });
  ipcMain.handle(IPC.mcpDiscover, async (_e, root: string) =>
    discoverMcpFile(await authorizeWorkspaceRoot(root, getHarnessSettings().workspaceRoot)),
  );
  ipcMain.handle(IPC.settingsModelsList, (_e, profileId: string) =>
    listProviderModelsById(profileId),
  );
  ipcMain.handle(IPC.settingsEnrichModels, (_e, providerName: string, ids: string[]) =>
    // 渲染层无法 import harness-electron（node 侧包），预设元数据在 main 补全。
    // 未命中预设（自定义厂家/未知型号）→ 返回最小 fetch 对象，不再误标 preset。
    ids.map((id) =>
      resolvePresetMeta(providerName, id)
        ? modelFromPreset(providerName, id)
        : { id, source: "fetch" as const },
    ),
  );

  ipcMain.handle(IPC.menuPopup, (_e, id: MenuId) => {
    popupMenu(needWindow(), id);
  });

  // -- Task review/route/complete channels (Task 7) ------------------------
  // Each handler delegates to TaskIpcHandlers which validates the calling
  // session, resolves task/route ownership, and delegates mutations to the
  // TaskCommandPort.  The handlers are wired after bridge composition.
  ipcMain.handle(TaskIpcChannels.taskStart, (_e, req) => requireTaskHandlers().start(req));
  ipcMain.handle(TaskIpcChannels.taskGet, (_e, req) => requireTaskHandlers().getTask(req));
  ipcMain.handle(TaskIpcChannels.taskChanges, (_e, req) => requireTaskHandlers().changes(req));
  ipcMain.handle(TaskIpcChannels.taskChange, (_e, req) => requireTaskHandlers().changeTask(req));
  ipcMain.handle(TaskIpcChannels.taskCheckpoint, (_e, req) => requireTaskHandlers().checkpoint(req));
  ipcMain.handle(TaskIpcChannels.taskReview, (_e, req) => requireTaskHandlers().review(req));
  ipcMain.handle(TaskIpcChannels.taskRestore, (_e, req) => requireTaskHandlers().restore(req));
  ipcMain.handle(TaskIpcChannels.taskListRoutes, (_e, req) => requireTaskHandlers().listRoutes(req));
  ipcMain.handle(TaskIpcChannels.taskSwitchRoute, (_e, req) => requireTaskHandlers().switchRoute(req));
  ipcMain.handle(TaskIpcChannels.taskForkRoute, (_e, req) => requireTaskHandlers().forkRoute(req));
  ipcMain.handle(TaskIpcChannels.taskEditUserMessage, (_e, req) => requireTaskHandlers().editUserMessage(req));
  ipcMain.handle(TaskIpcChannels.taskRetryAssistant, (_e, req) => requireTaskHandlers().retryAssistant(req));
  ipcMain.handle(TaskIpcChannels.taskComplete, (_e, req) => requireTaskHandlers().complete(req));
  ipcMain.handle(TaskIpcChannels.taskApply, (_e, req) => requireTaskHandlers().applyAccepted(req));
  ipcMain.handle(TaskIpcChannels.taskResolveConflict, (_e, req) => requireTaskHandlers().resolveConflict(req));
  ipcMain.handle(TaskIpcChannels.taskValidate, (_e, req) => requireTaskHandlers().validate(req));
  ipcMain.handle(TaskIpcChannels.taskRecoveryWarnings, (_e, req) => requireTaskHandlers().recoveryWarnings(req));
  // Recovery retry (Task 12): renderer re-runs worktree/replay recovery.
  ipcMain.handle(TaskIpcChannels.taskRecover, (_e, req) => requireTaskHandlers().recover(req));
}
