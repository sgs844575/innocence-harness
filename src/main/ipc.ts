// IPC surface — one handler per channel defined in src/shared/ipc.ts.
import { app, dialog, ipcMain, shell, webContents } from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import { IPC, isChatQuestionResponse, isPermissionChoice, type BrowserEmulateRequest, type MenuId } from "../shared/ipc";
import { modelFromPreset, resolvePresetMeta } from "@innocenceharness/harness-electron";
import { discoverExternalSkills, importSkill, type DiscoveredSkill } from "./skillDiscovery";
import { discoverMcpFile, importMcpServers, parseMcpImport } from "./mcpImport";
import { authorizeWorkspaceRoot } from "./mcpAuthorization";
import { TaskIpcChannels } from "../shared/taskIpc";
import { broadcastTheme, getTheme, setTheme } from "./theme";
import * as sessions from "./sessions";
import {
  getAgentModes,
  getCommittedHarnessSettings,
  getHarnessSettings,
  getPluginInventory,
  generateAutomationCandidate,
  generateCommitMessage,
  confirmAutomation,
  updateAutomation,
  deleteAutomation,
  listAutomations,
  triggerAutomation,
  listProviderModelsById,
  pickWorkspace,
  listPendingQuestionCards,
  respondPermission,
  respondQuestion,
  resendChatTurn,
  sendChatTurn,
  setHarnessSettings,
  getSkillCatalog,
  stopChatTurn,
  cancelSubagentRun,
  updateProviderApiKey,
  disposeSession,
  getBackgroundJobs,
} from "./harnessGlue";
import type { HarnessSettingsPatch } from "../shared/settingsPatch";
import { popupMenu } from "./menu";
import { getMainWindow } from "./appWindow";
import { appDataRoot } from "./appDataRoot";
import { currentLogFile, logger } from "./logger";
import { toAppProcessMetrics } from "./processMetrics";
import { copyLogFiles } from "./exportLogs";
import { listWorkspaceDir, listWorkspaceFiles, readWorkspaceFile } from "./workspaceFiles";
import { broadcastSessions, broadcastSidebar } from "./sessionEvents";
import { TaskIpcHandlers } from "./taskIpcHandlers";
import { createGitAdapter, type GitAdapter } from "@innocenceharness/task-git";
import { resolveTerminalFont } from "@innocenceharness/terminal-pty";
import { workspaceReviewFileDiff, workspaceReviewFiles } from "./workspaceReview";
import { workspaceGitGraph } from "./workspaceGitGraph";
import { countPorcelain, workspaceGitCommit, workspaceGitPush, workspaceGitSummary } from "./workspaceCommit";
import { getDataRoot, setDataRoot } from "./dataRoot";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** 落地页分支胶囊用的 Git 探测（懒加载单例；非仓库/异常 → null）。 */
let gitAdapter: GitAdapter | undefined;
async function detectWorkspaceGitBranch(root: string): Promise<string | null> {
  try {
    gitAdapter ??= createGitAdapter();
    const info = await gitAdapter.detect(root);
    return info.branch ?? null;
  } catch {
    return null;
  }
}

/** Git 面板「更改」统计：porcelain 计文件数（含暂存/未暂存拆分），shortstat 取增删行（失败 → null）。 */
async function workspaceGitChangesStat(
  root: string,
): Promise<{ changedFiles: number; additions: number; deletions: number; stagedFiles: number; unstagedFiles: number } | null> {
  try {
    const { stdout: status } = await execFileAsync("git", ["-C", root, "status", "--porcelain"], { windowsHide: true });
    const counts = countPorcelain(status);
    let shortstat = "";
    try {
      ({ stdout: shortstat } = await execFileAsync("git", ["-C", root, "diff", "--shortstat", "HEAD"], { windowsHide: true }));
    } catch {
      // 空仓无 HEAD：退化为工作区+暂存统计。
      ({ stdout: shortstat } = await execFileAsync("git", ["-C", root, "diff", "--shortstat"], { windowsHide: true }));
    }
    const additions = /(\d+) insertion/.exec(shortstat);
    const deletions = /(\d+) deletion/.exec(shortstat);
    return {
      changedFiles: counts.changed,
      additions: additions ? Number(additions[1]) : 0,
      deletions: deletions ? Number(deletions[1]) : 0,
      stagedFiles: counts.staged,
      unstagedFiles: counts.unstaged,
    };
  } catch {
    return null;
  }
}

/** 分支面板：本地分支短名列表 + 当前分支（非仓库/失败 → null）。 */
async function workspaceGitBranchList(
  root: string,
): Promise<{ current: string | null; branches: string[] } | null> {
  try {
    const { stdout } = await execFileAsync("git", ["-C", root, "branch", "--format=%(refname:short)"], { windowsHide: true });
    gitAdapter ??= createGitAdapter();
    const info = await gitAdapter.detect(root);
    return {
      current: info.branch ?? null,
      branches: stdout.split("\n").map((line) => line.trim()).filter(Boolean),
    };
  } catch {
    return null;
  }
}

/** 分支面板：检出（create=true 时先建）分支。失败回传 stderr 末行摘要。 */
async function workspaceGitCheckoutBranch(
  root: string,
  branch: string,
  create: boolean,
): Promise<{ ok: boolean; branch?: string; error?: string }> {
  const name = branch.trim();
  // execFile 不过 shell，但仍挡掉会被 git 当成选项的名字。
  if (name === "" || name.startsWith("-")) return { ok: false, error: "invalid branch name" };
  try {
    const args = create ? ["-C", root, "checkout", "-b", name] : ["-C", root, "checkout", name];
    await execFileAsync("git", args, { windowsHide: true });
    return { ok: true, branch: name };
  } catch (error) {
    const stderr =
      typeof error === "object" && error !== null && "stderr" in error
        ? String((error as { stderr: unknown }).stderr).trim()
        : "";
    return { ok: false, error: stderr.split("\n").pop() || "checkout failed" };
  }
}

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

  // 自绘窗口控制（TitleBar 的最小化/最大化切换/关闭）。
  ipcMain.handle(IPC.windowMinimize, () => needWindow().minimize());
  ipcMain.handle(IPC.windowToggleMaximize, () => {
    const win = needWindow();
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
  });
  ipcMain.handle(IPC.windowClose, () => needWindow().close());
  ipcMain.handle(IPC.windowMaximizedGet, () => needWindow().isMaximized());

  // 顶栏应用菜单：进程监视器快照（映射在 processMetrics.ts）。
  ipcMain.handle(IPC.appMetrics, () => toAppProcessMetrics(app.getAppMetrics()));

  // 顶栏应用菜单「导出日志」：用户选目录后平铺复制应用数据根 logs 的日志文件。
  ipcMain.handle(IPC.appExportLogs, async () => {
    const picked = await dialog.showOpenDialog(needWindow(), {
      properties: ["openDirectory", "createDirectory"],
    });
    const target = picked.filePaths[0];
    if (picked.canceled || !target) return null;
    const exported = await copyLogFiles(path.join(appDataRoot(), "logs"), target);
    return exported > 0 ? { exported } : null;
  });

  // 常规设置「数据存储位置」：当前/默认数据根查询、目录选择、迁移并重启。
  ipcMain.handle(IPC.appGetDataRoot, () => getDataRoot());
  ipcMain.handle(IPC.appPickDirectory, async () => {
    const picked = await dialog.showOpenDialog(needWindow(), {
      properties: ["openDirectory", "createDirectory"],
    });
    const target = picked.filePaths[0];
    return picked.canceled || !target ? null : target;
  });
  ipcMain.handle(IPC.appSetDataRoot, (_e, parentDir: string) => setDataRoot(parentDir));

  // 常规设置「终端字体」：生效字体解析（覆盖/系统终端探测；无 → null）。
  ipcMain.handle(IPC.terminalResolvedFont, () => resolveTerminalFont(getHarnessSettings()));

  ipcMain.handle(IPC.sessionsList, () => sessions.listSessions());
  ipcMain.handle(IPC.sessionRename, (_e, id: string, title: string) => {
    const session = sessions.renameSession(id, title);
    broadcastSessions();
    broadcastSidebar();
    return session;
  });
  ipcMain.handle(IPC.sidebarGet, () => sessions.getSidebarState());
  ipcMain.handle(IPC.sidebarArchive, (_e, id: string, archived: boolean) => {
    sessions.archiveSession(id, archived);
    broadcastSidebar();
  });
  ipcMain.handle(IPC.sidebarPin, (_e, id: string, pinned: boolean) => {
    sessions.pinSession(id, pinned);
    broadcastSidebar();
  });
  ipcMain.handle(IPC.sidebarUnread, (_e, id: string, unread: boolean) => {
    sessions.markSessionUnread(id, unread);
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
  ipcMain.handle(IPC.sessionCreate, (_e, options?: { title?: string; workspaceRoot?: string; aux?: boolean }) => {
    const session = sessions.createSession({ title: options?.title, workspaceRoot: options?.workspaceRoot, aux: options?.aux });
    broadcastSessions();
    broadcastSidebar();
    return session;
  });
  ipcMain.handle(
    IPC.sessionFork,
    async (_e, id: string, options?: { upToMessageId?: string; worktree?: boolean }) => {
      // M1 会话 fork：无效切口/父会话缺失返回 null，由渲染层提示。
      const session = await sessions.forkSession(id, options);
      if (session) {
        broadcastSessions();
        broadcastSidebar();
      }
      return session ?? null;
    },
  );
  ipcMain.handle(
    IPC.backgroundStart,
    (_e, prompt: string, options?: { workspaceRoot?: string }) =>
      getBackgroundJobs().start(prompt, options),
  );
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
  // 上下文容量指示器：按会话查当前计量快照（未水合先惰性水合；无 → null）。
  ipcMain.handle(IPC.contextUsageQuery, (_e, sessionId: string) => sessions.getContextUsage(sessionId));
  ipcMain.handle(IPC.subagentHistory, (_e, sessionId: string) => sessions.listSubagentHistory(sessionId));
  ipcMain.handle(IPC.subagentCancel, (_e, sessionId: string, childId: string) =>
    cancelSubagentRun(sessionId, childId));

  ipcMain.handle(IPC.chatSend, (_e, sessionId: string, text: string, userMessageId?: string) => {
    needWindow();
    const trimmed = text.trim();
    if (!trimmed) throw new Error("empty message");
    // 落账沿用渲染层乐观气泡的 id（见 adoptMessageId），保证后续编辑重发
    // 的截断能在存储中找到这条用户消息。
    sessions.appendMessage(sessionId, {
      id: sessions.adoptMessageId(sessionId, userMessageId),
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

  // 编辑重发（替换语义）：主进程截断存储/转录并回退运行时历史后重开一轮；
  // 运行中/任务绑定/未知消息 id 抛错，由渲染层提示并回读存储恢复。
  // newMessageId 为渲染层乐观新气泡的 id，落账沿用同一 id（见 adoptMessageId）。
  ipcMain.handle(IPC.chatResend, (_e, sessionId: string, fromMessageId: string, text: string, newMessageId?: string) => {
    needWindow();
    const messageId = resendChatTurn(sessionId, fromMessageId, text, newMessageId);
    broadcastSessions();
    broadcastSidebar();
    logger.info("chat:resend", { sessionId, messageId, fromMessageId });
    return { messageId };
  });

  ipcMain.handle(IPC.chatStop, (_e, sessionId: string) => {
    stopChatTurn(sessionId);
  });

  ipcMain.handle(IPC.chatPermissionRespond, async (_e, requestId: string, choice: unknown): Promise<void> => {
    if (!isPermissionChoice(choice)) throw new Error("invalid permission choice");
    await respondPermission(requestId, choice);
  });

  // 询问卡作答：载荷校验后直达 harnessGlue 的挂起问题注册表（未知 id 幂等）。
  ipcMain.handle(IPC.chatQuestionRespond, async (_e, requestId: string, response: unknown): Promise<void> => {
    if (!isChatQuestionResponse(response)) throw new Error("invalid question response");
    await respondQuestion(requestId, response);
  });

  // 询问卡回放：会话激活时拉取该会话仍挂起的问题卡（切会话回来补卡）。
  ipcMain.handle(IPC.chatPendingQuestions, (_e, sessionId: string) =>
    typeof sessionId === "string" && sessionId.trim() !== ""
      ? listPendingQuestionCards(sessionId)
      : [],
  );

  ipcMain.handle(IPC.workspacePick, () => pickWorkspace());

  ipcMain.handle(IPC.workspaceGitBranch, (_e, root: string) =>
    typeof root === "string" && root.trim() !== "" ? detectWorkspaceGitBranch(root.trim()) : null,
  );

  ipcMain.handle(IPC.workspaceGitChanges, (_e, root: string) =>
    typeof root === "string" && root.trim() !== "" ? workspaceGitChangesStat(root.trim()) : null,
  );

  ipcMain.handle(IPC.workspaceGitBranches, (_e, root: string) =>
    typeof root === "string" && root.trim() !== "" ? workspaceGitBranchList(root.trim()) : null,
  );

  ipcMain.handle(IPC.workspaceGitCheckout, (_e, root: string, branch: string, create?: boolean) =>
    typeof root === "string" && root.trim() !== "" && typeof branch === "string"
      ? workspaceGitCheckoutBranch(root.trim(), branch, create === true)
      : { ok: false, error: "invalid arguments" },
  );

  // Git 图谱对话框：全分支拓扑序提交数据（只读 git 查询，见 workspaceGitGraph.ts）。
  ipcMain.handle(IPC.workspaceGitGraph, (_e, root: string) =>
    typeof root === "string" && root.trim() !== "" ? workspaceGitGraph(root.trim()) : null,
  );

  // 提交面板：AI 生成提交信息（无更改 → nothing to commit；模型/供应商失败 → error）。
  ipcMain.handle(IPC.workspaceGitCommitMessage, async (_e, root: string) => {
    if (typeof root !== "string" || root.trim() === "") return { ok: false, error: "invalid arguments" };
    try {
      const summary = await workspaceGitSummary(root.trim());
      if (summary === null) return { ok: false, error: "nothing to commit" };
      return { ok: true, message: await generateCommitMessage(summary) };
    } catch (error) {
      return { ok: false, error: String(error) };
    }
  });

  // 提交面板：提交（stageAll 时先 add -A；message 为空时自动生成提交信息）。
  ipcMain.handle(IPC.workspaceGitCommit, (_e, root: string, message: unknown, stageAll: unknown) =>
    typeof root === "string" && root.trim() !== ""
      ? workspaceGitCommit(root.trim(), typeof message === "string" ? message : "", stageAll === true, {
          generate: generateCommitMessage,
        })
      : { ok: false, error: "invalid arguments" },
  );

  // 提交面板：推送（无上游时自动 --set-upstream origin HEAD）。
  ipcMain.handle(IPC.workspaceGitPush, (_e, root: string) =>
    typeof root === "string" && root.trim() !== "" ? workspaceGitPush(root.trim()) : { ok: false, error: "invalid arguments" },
  );

  // 侧栏文件树：目录列举 / 文本读取 / 全量清单（路径防护在 workspaceFiles.ts）。
  const validRoot = (root: unknown): root is string => typeof root === "string" && root.trim() !== "";
  ipcMain.handle(IPC.workspaceListDir, (_e, root: string, relDir: string) =>
    validRoot(root) && typeof relDir === "string" ? listWorkspaceDir(root.trim(), relDir) : [],
  );
  ipcMain.handle(IPC.workspaceReadFile, (_e, root: string, rel: string) => {
    if (!validRoot(root) || typeof rel !== "string" || rel.trim() === "") {
      throw new Error("workspace files: invalid arguments");
    }
    return readWorkspaceFile(root.trim(), rel);
  });
  ipcMain.handle(IPC.workspaceListFiles, (_e, root: string) =>
    validRoot(root) ? listWorkspaceFiles(root.trim()) : [],
  );

  // 审查面板：改动文件列表与单文件 diff（只读 git 查询，见 workspaceReview.ts）。
  ipcMain.handle(IPC.workspaceGitReviewFiles, (_e, root: string, scope: unknown) =>
    typeof root === "string" && root.trim() !== ""
      ? workspaceReviewFiles(root.trim(), scope === "staged" ? "staged" : "unstaged")
      : null,
  );
  ipcMain.handle(IPC.workspaceGitReviewDiff, (_e, root: string, scope: unknown, relPath: string) =>
    typeof root === "string" && root.trim() !== "" && typeof relPath === "string" && relPath.trim() !== ""
      ? workspaceReviewFileDiff(root.trim(), scope === "staged" ? "staged" : "unstaged", relPath)
      : null,
  );

  // dock 浏览器：设备度量仿真（CDP Emulation）；只接受挂在主窗口上的 webview
  // 访客（hostWebContents 非空），拒绝主窗口自身或来历不明的 webContents。
  ipcMain.handle(IPC.browserEmulate, async (_e, req: BrowserEmulateRequest) => {
    const guestId = Number(req?.guestId);
    if (!Number.isInteger(guestId) || guestId <= 0) return { ok: false, error: "invalid guestId" };
    const guest = webContents.fromId(guestId);
    if (!guest || guest.isDestroyed()) return { ok: false, error: "guest gone" };
    if (!guest.hostWebContents) return { ok: false, error: "not a webview guest" };
    const width = req.width === null ? null : Number(req.width);
    const height = req.height === null ? null : Number(req.height);
    try {
      try {
        guest.debugger.attach("1.3");
      } catch {
        // 已附着（重复仿真）——直接发命令。
      }
      if (width === null || height === null) {
        await guest.debugger.sendCommand("Emulation.clearDeviceMetricsOverride");
      } else {
        if (!Number.isInteger(width) || !Number.isInteger(height) || width < 50 || height < 50 || width > 4000 || height > 4000) {
          return { ok: false, error: "invalid size" };
        }
        await guest.debugger.sendCommand("Emulation.setDeviceMetricsOverride", {
          width,
          height,
          deviceScaleFactor: 0,
          mobile: req.mobile === true,
        });
      }
      return { ok: true };
    } catch (error) {
      return { ok: false, error: String(error) };
    }
  });

  // 会话「…」菜单宿主动作：文件管理器打开目录 / 外部链接（仅 http(s)）。
  ipcMain.handle(IPC.hostRevealPath, async (_e, target: string) => {
    if (typeof target !== "string" || target.trim() === "") return;
    await shell.openPath(target.trim());
  });
  ipcMain.handle(IPC.hostOpenExternal, async (_e, url: string) => {
    if (typeof url !== "string" || !/^https?:\/\//i.test(url)) return;
    await shell.openExternal(url);
  });
  ipcMain.handle(IPC.sessionPaths, (_e, id: string) => ({
    taskPath: typeof id === "string" ? sessions.getSessionTranscriptPath(id) : null,
    logPath: currentLogFile(),
  }));

  ipcMain.handle(IPC.settingsGet, () => getCommittedHarnessSettings());
  ipcMain.handle(IPC.settingsSet, (_e, next: HarnessSettingsPatch) => setHarnessSettings(next));
  ipcMain.handle(IPC.settingsApiKeySet, (_e, profileId: string, apiKey: string) =>
    updateProviderApiKey(profileId, apiKey),
  );
  // 插件清单投影：main 按当前 toggles 现算（无 boot 时阻塞到 boot 完成）。
  ipcMain.handle(IPC.pluginsList, () => getPluginInventory());
  // Agent 模式目录：manifest 直读 + 用户根扫描现算（无 boot 依赖）。
  ipcMain.handle(IPC.agentsModes, () => getAgentModes());
  // 技能目录（输入卡 / 补全）：内置常驻 + 缺省双根扫描现算；空 root = 仅用户根。
  ipcMain.handle(IPC.skillsList, (_e, root: unknown) =>
    typeof root === "string" ? getSkillCatalog(root) : getSkillCatalog(""),
  );
  ipcMain.handle(IPC.automationCandidate, (_e, prompt: string) => generateAutomationCandidate(prompt));
  ipcMain.handle(IPC.automationConfirm, (_e, request) => confirmAutomation(request.candidate, request.name, request.targetSessionId));
  ipcMain.handle(IPC.automationUpdate, (_e, request) => updateAutomation(
    request.id,
    request.candidate,
    request.name,
    request.targetSessionId,
    request.enabled,
  ));
  ipcMain.handle(IPC.automationDelete, (_e, id: string) => deleteAutomation(id));
  ipcMain.handle(IPC.automationList, () => listAutomations());
  ipcMain.handle(IPC.automationTrigger, (_e, request) => triggerAutomation(request));
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
