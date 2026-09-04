// 自动归档（autoArchiveTasks 设置）：启动后立即巡检一轮，之后每 30 分钟一
// 轮；每轮读当前设置（关闭即空转，live 跟随设置变更）。候选 = 未归档、未
// 置顶、updatedAt 早于保留期、无存活回合、非 dock 辅助会话；主进程尚未跟
// 踪未读标记（渲染层「标记为未读」仍为禁用项），接入后需在候选判定中一并
// 排除。归档走与手动归档同一存储变更（sessions.archiveSession），变更后同
// 一 broadcastSidebar 推送。模块本体无 Electron——依赖全注入。
export const AUTO_ARCHIVE_INTERVAL_MS = 30 * 60 * 1000;

export interface AutoArchiveSessionLike {
  id: string;
  updatedAt: number;
  /** dock 辅助会话不进侧栏会话列表，不参与归档。 */
  aux?: boolean;
}

export interface AutoArchiveSidebarLike {
  archived: Record<string, boolean>;
  pinned: Record<string, boolean>;
}

/**
 * 候选选择（纯函数）：未归档 + 未置顶 + 非辅助会话 + updatedAt 早于保留窗
 * （now - retentionDays 天）。存活回合的排除在运行侧（需要运行时查询）。
 */
export function selectAutoArchiveCandidates(
  sessions: readonly AutoArchiveSessionLike[],
  sidebar: AutoArchiveSidebarLike,
  now: number,
  retentionDays: number,
): string[] {
  const cutoff = now - retentionDays * 24 * 60 * 60 * 1000;
  return sessions
    .filter(
      (session) =>
        session.aux !== true &&
        sidebar.archived[session.id] !== true &&
        sidebar.pinned[session.id] !== true &&
        session.updatedAt < cutoff,
    )
    .map((session) => session.id);
}

export interface AutoArchiveDeps {
  /** 当前设置投影（惰性读取，live 跟随设置变更）。 */
  settings(): { autoArchiveTasks?: boolean; archiveRetentionDays?: number };
  listSessions(): readonly AutoArchiveSessionLike[];
  sidebarState(): AutoArchiveSidebarLike;
  /** 会话是否有存活回合（主路由 + 任务绑定路由）。 */
  isRunning(sessionId: string): boolean;
  /** 与手动归档同一存储变更。 */
  archive(id: string): void;
  /** 归档后的侧栏变更广播。 */
  broadcast(): void;
  log?(level: "info" | "warn" | "error", msg: string, data?: unknown): void;
  now?(): number;
  intervalMs?: number;
}

export interface AutoArchiveService {
  /** 立即巡检一轮；返回本轮归档的会话 id。 */
  runOnce(): string[];
  /** 停止周期巡检（关机路径）。 */
  stop(): void;
}

export function startAutoArchive(deps: AutoArchiveDeps): AutoArchiveService {
  const now = deps.now ?? (() => Date.now());
  const intervalMs = deps.intervalMs ?? AUTO_ARCHIVE_INTERVAL_MS;

  const runOnce = (): string[] => {
    const settings = deps.settings();
    if (settings.autoArchiveTasks !== true) return [];
    const retentionDays =
      typeof settings.archiveRetentionDays === "number" && settings.archiveRetentionDays > 0
        ? settings.archiveRetentionDays
        : 7;
    const candidates = selectAutoArchiveCandidates(
      deps.listSessions(),
      deps.sidebarState(),
      now(),
      retentionDays,
    ).filter((id) => !deps.isRunning(id));
    const archived: string[] = [];
    for (const id of candidates) {
      try {
        deps.archive(id);
        archived.push(id);
      } catch (error) {
        // 单条失败不阻断整轮巡检。
        deps.log?.("warn", "auto-archive session failed", { id, error: String(error) });
      }
    }
    if (archived.length > 0) {
      deps.broadcast();
      deps.log?.("info", "auto-archive archived sessions", { count: archived.length });
    }
    return archived;
  };

  const tick = (): void => {
    try {
      runOnce();
    } catch (error) {
      deps.log?.("warn", "auto-archive tick failed", { error: String(error) });
    }
  };

  // 启动后立即一轮，再按周期巡检；计时器不阻止进程退出。
  tick();
  const timer = setInterval(tick, intervalMs);
  if (typeof timer === "object" && typeof timer.unref === "function") timer.unref();

  return {
    runOnce,
    stop: () => clearInterval(timer),
  };
}
