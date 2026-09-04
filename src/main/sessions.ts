// Session store facade: owns the in-memory session table (order + records)
// and assembles the storage responsibilities behind the stable exports —
// sessionIndexStore.ts (index I/O), sessionFiles.ts (date-partitioned
// sessions/ tree, scan + legacy migration), sessionHydration.ts (lazy
// transcript hydration incl. corrupt-transcript self-heal), sessionMessages.ts
// (message mutation). 历史不丢的契约：JSONL 转录文件是事实源（自描述
// session-meta 行 + 追加式实时落盘由运行时负责），sessions.json 只是可由
// 启动扫描重建的缓存。The module stays electron-free so vitest can exercise
// it directly; initSessionStore(dir) runs once from the main entry.
import fs from "node:fs";
import path from "node:path";
import {
  DEFAULT_ROUTE_ID,
  encodeSessionMeta,
  routeFileBeside,
  type SessionMetaRecord,
} from "@innocenceharness/harness-electron";
import {
  loadSessionIndex,
  persistSessionIndex,
  publicSessionView,
  sessionIndexEntryOf,
  sessionIndexFile,
  sessionRecordFromEntry,
  type SessionRecord,
} from "./sessionIndexStore";
import {
  migrateLegacyTranscripts,
  readSessionMetaPrefix,
  scanSessionFiles,
  sessionFileInTree,
  sessionsRoot,
  type ScannedSessionFile,
} from "./sessionFiles";
import { hydrateSessionMessages } from "./sessionHydration";
import { removeSessionScratchDir } from "./sessionScratch";
import { appendSessionMessage, updateSessionMessage } from "./sessionMessages";
import { rewriteSessionTranscript, truncateSessionMessages, type SessionRewind } from "./sessionRewind";
import {
  createForkWorktree,
  forkMessagePrefix,
  forkSessionRecord,
  forkWorktreeSessionRecord,
  writeForkTranscript,
  type SessionForkOptions,
} from "./sessionFork";
import { createSidebarIndexStore, type SidebarIndexStore, type SidebarState } from "./sidebarIndexStore";
import {
  readSubagentHistory,
  subagentHistoryFile,
  type SubagentHistoryEntry,
} from "./subagentHistoryStore";
import type { SidebarContainer } from "../shared/sidebarIpc";
import type { ChatMessage, Session } from "../shared/ipc";

export type { SessionRecord } from "./sessionIndexStore";

const sessions = new Map<string, SessionRecord>();
// Newest first when listing, mirroring a typical chat sidebar.
const order: string[] = [];
let storeDir: string | null = null;
let sidebarStore: SidebarIndexStore | null = null;
/** id → 主转录绝对路径（扫描/创建时登记；运行时落盘与读取都走这里）。 */
const fileMap = new Map<string, string>();
/** id → 已落盘的最后一条 session-meta 行（变化才追加，避免索引级写放大）。 */
const metaOnDisk = new Map<string, Omit<SessionMetaRecord, "type" | "at">>();

function currentSidebarSessions(): Session[] {
  return order.map((id) => sessions.get(id)).filter((record): record is SessionRecord => record !== undefined).map(publicSessionView);
}

function syncSidebar(): void {
  sidebarStore?.replaceSessions(currentSidebarSessions());
}

function persistIndex(): void {
  persistSessionIndex(
    sessionIndexFile(storeDir),
    order.map((id) => sessionIndexEntryOf(sessions.get(id)!)),
  );
}

/** 记录的元数据投影（session-meta 行载荷；字段序固定，等值比较用）。 */
function metaOf(record: SessionRecord): Omit<SessionMetaRecord, "type" | "at"> {
  return {
    id: record.id,
    title: record.title,
    createdAt: record.createdAt,
    ...(record.workspaceRoot ? { workspaceRoot: record.workspaceRoot } : {}),
    ...(record.aux === true ? { aux: true } : {}),
    ...(record.forkedFrom ? { forkedFrom: { ...record.forkedFrom } } : {}),
  };
}

function sameMeta(a: Omit<SessionMetaRecord, "type" | "at">, b: Omit<SessionMetaRecord, "type" | "at">): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** 元数据变化时向转录文件追加一条 session-meta 行（last-wins 自描述）。 */
function syncSessionMeta(record: SessionRecord): void {
  const file = fileMap.get(record.id);
  if (!file) return;
  const next = metaOf(record);
  const prev = metaOnDisk.get(record.id);
  if (prev && sameMeta(prev, next)) return;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, encodeSessionMeta(next, new Date().toISOString()), "utf8");
    metaOnDisk.set(record.id, next);
  } catch {
    // 自描述行写失败不阻断聊天；下次变化或重启扫描重试。
  }
}

function hydrate(record: SessionRecord): void {
  hydrateSessionMessages(record, {
    transcriptFile: fileMap.get(record.id) ?? null,
    persistIndex,
  });
  // 旧布局文件没有 session-meta 行：水合后补写一条，令其自此自描述。
  syncSessionMeta(record);
}

/** 扫描恢复的记录：meta 行优先，缺失回退文件 mtime 与默认标题。 */
function sessionRecordFromScan(
  id: string,
  scanned: ScannedSessionFile,
  base: string,
): { record: SessionRecord; meta?: SessionMetaRecord } {
  const meta = readSessionMetaPrefix(scanned.file);
  const createdAt = meta?.createdAt ?? Math.round(scanned.mtimeMs);
  const record: SessionRecord = {
    id,
    title: meta?.title ?? "新会话",
    createdAt,
    updatedAt: createdAt,
    messageCount: 0, // hydration 惰性校准（读文件计数）
    workspaceRoot: meta?.workspaceRoot ?? "",
    ...(meta?.aux === true ? { aux: true } : {}),
    ...(meta?.forkedFrom ? { forkedFrom: { ...meta.forkedFrom } } : {}),
    file: path.relative(sessionsRoot(base), scanned.file),
    messages: [],
    messagesLoaded: false,
  };
  return { record, ...(meta ? { meta } : {}) };
}

/**
 * Loads the persisted index — then makes the sessions/ tree authoritative:
 * legacy flat transcripts migrate into the date tree, and every scanned file
 * the index does not know about is rebuilt from its own session-meta row (or
 * file mtime). The index is a rebuildable cache, never the sole entry point.
 * Idempotent; call once at app start (tests may re-init).
 */
export function initSessionStore(userDataDir: string): void {
  storeDir = userDataDir;
  sessions.clear();
  order.length = 0;
  fileMap.clear();
  metaOnDisk.clear();
  const migrate = migrateLegacyTranscripts(storeDir, [storeDir]);
  const scanned = scanSessionFiles(storeDir);
  const indexed = new Set<string>();
  for (const e of loadSessionIndex(sessionIndexFile(storeDir))) {
    if (!e || typeof e.id !== "string") continue;
    const record = sessionRecordFromEntry(e);
    const file = scanned.get(e.id)?.file
      ?? (record.file ? path.join(sessionsRoot(storeDir), record.file) : undefined);
    if (file) {
      record.file = path.relative(sessionsRoot(storeDir), file);
      fileMap.set(e.id, file);
      const meta = readSessionMetaPrefix(file);
      if (meta) metaOnDisk.set(e.id, meta);
    }
    sessions.set(e.id, record);
    order.push(e.id);
    indexed.add(e.id);
  }
  let rebuilt = 0;
  for (const [id, entry] of scanned) {
    if (indexed.has(id)) continue;
    const { record, meta } = sessionRecordFromScan(id, entry, storeDir);
    sessions.set(id, record);
    order.push(id);
    fileMap.set(id, entry.file);
    if (meta) metaOnDisk.set(id, meta);
    rebuilt += 1;
  }
  if (rebuilt > 0 || migrate.moved.length > 0) persistIndex();
  sidebarStore = createSidebarIndexStore(storeDir, currentSidebarSessions());
  syncSidebar();
}

export function listSessions(): Session[] {
  return order.map((id) => publicSessionView(sessions.get(id)!));
}

export function createSession(options?: { title?: string; workspaceRoot?: string; aux?: boolean }): Session {
  const id = `sess_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const now = Date.now();
  const record: SessionRecord = {
    id,
    title: options?.title?.trim() || "新会话",
    createdAt: now,
    updatedAt: now,
    messageCount: 0,
    workspaceRoot: options?.workspaceRoot ?? "",
    ...(options?.aux === true ? { aux: true } : {}),
    messages: [],
    messagesLoaded: true, // Fresh session: nothing on disk to restore.
  };
  if (storeDir) {
    const file = sessionFileInTree(sessionsRoot(storeDir), id, now);
    record.file = path.relative(sessionsRoot(storeDir), file);
    fileMap.set(id, file);
  }
  sessions.set(id, record);
  order.unshift(id);
  syncSessionMeta(record); // 自出生即自描述
  persistIndex();
  syncSidebar();
  return publicSessionView(record);
}

export function deleteSession(id: string): void {
  sessions.delete(id);
  const idx = order.indexOf(id);
  if (idx >= 0) order.splice(idx, 1);
  persistIndex();
  syncSidebar();
  removeSessionFiles(id);
  // 无项目会话的暂存目录随会话一并清理（尽力而为，失败不阻断删除；异步
  // 不阻塞主进程，见 sessionScratch.ts）。
  void removeSessionScratchDir(id);
}

/** 删除一个会话的全部落盘文件：主转录、子代理档案与同目录路由转写。 */
function removeSessionFiles(id: string): void {
  const file = fileMap.get(id);
  fileMap.delete(id);
  metaOnDisk.delete(id);
  if (!file) return;
  try {
    const dir = path.dirname(file);
    for (const name of fs.readdirSync(dir)) {
      if (name === `${id}.jsonl` || name === `${id}.subagents.jsonl`
        || (name.startsWith(`${id}_`) && name.endsWith(".jsonl"))) {
        fs.rmSync(path.join(dir, name), { force: true });
      }
    }
  } catch {
    // Transcript removal is best-effort; the session itself is gone.
  }
}

/** 子代理运行档案（sidecar 回放用；渲染层按激活会话拉取建档）。 */
export function listSubagentHistory(sessionId: string): SubagentHistoryEntry[] {
  return readSubagentHistory(subagentHistoryFile(fileMap.get(sessionId) ?? null, sessionId));
}

/** 子代理档案落盘路径（lifecycle 事件转发热路径用）；未知会话 → null。 */
export function sessionSubagentHistoryFile(sessionId: string): string | null {
  return subagentHistoryFile(fileMap.get(sessionId) ?? null, sessionId);
}

/**
 * M1 会话 fork（存储编排半边）：按用户消息切口把父会话的已水合历史分叉成
 * 新会话——种子转录走既有 hydration/运行时播种路径，索引记录 forkedFrom
 * 血缘。无效切口（未知 id / 非用户消息）或父会话不存在返回 undefined。
 * worktree 模式（A:95）：父工作区自 HEAD 建分离工作树并绑定为新会话根
 *（父工作树因根切换天然禁入）；非 Git/创建失败同样返回 undefined。
 */
export async function forkSession(
  parentId: string,
  options?: SessionForkOptions,
): Promise<Session | undefined> {
  const parent = sessions.get(parentId);
  if (!parent) return undefined;
  if (!parent.messagesLoaded) hydrate(parent);
  const prefix = forkMessagePrefix(parent.messages, options?.upToMessageId);
  if (prefix === undefined) return undefined;
  const id = `sess_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  let worktreeRoot: string | undefined;
  if (options?.worktree === true) {
    worktreeRoot = await createForkWorktree(parent.workspaceRoot ?? "", id);
    if (!worktreeRoot) return undefined;
  }
  const file = storeDir ? sessionFileInTree(sessionsRoot(storeDir), id, Date.now()) : null;
  if (file) fileMap.set(id, file);
  writeForkTranscript(file, prefix);
  const record = worktreeRoot
    ? forkWorktreeSessionRecord(parent, prefix, {
        id,
        now: Date.now(),
        upToMessageId: options?.upToMessageId,
        worktreeRoot,
      })
    : forkSessionRecord(parent, prefix, {
        id,
        now: Date.now(),
        upToMessageId: options?.upToMessageId,
      });
  if (file && storeDir) record.file = path.relative(sessionsRoot(storeDir), file);
  sessions.set(id, record);
  order.unshift(id);
  syncSessionMeta(record); // 分叉种子文件补自描述头
  persistIndex();
  syncSidebar();
  return publicSessionView(record);
}

export function getSession(id: string): SessionRecord | undefined {
  return sessions.get(id);
}

/** 会话转录文件绝对路径（「复制任务路径」菜单项）；未知会话 → null。 */
export function getSessionTranscriptPath(id: string): string | null {
  return sessions.has(id) ? fileMap.get(id) ?? null : null;
}

/**
 * 运行时转录文件解析端口（HarnessRuntime transcriptFileFor）：主路由 =
 * 会话主文件；其他路由 = 同目录 `<id>_<routeId>.jsonl`（安全段校验与包内
 * 写路径同源）。未知会话 → null（运行时跳过持久化并告警——创建会话必先于
 * 任何发送）。
 */
export function runtimeTranscriptFileFor(sessionId: string, routeId: string): string | null {
  const file = fileMap.get(sessionId);
  if (!file) return null;
  return routeId === DEFAULT_ROUTE_ID || routeId === "" ? file : routeFileBeside(file, sessionId, routeId);
}

export function listMessages(id: string): ChatMessage[] {
  const record = sessions.get(id);
  if (!record) return [];
  if (!record.messagesLoaded) hydrate(record);
  return record.messages;
}

export function appendMessage(id: string, message: ChatMessage): void {
  const record = sessions.get(id);
  if (!record) return;
  if (!record.messagesLoaded) hydrate(record);
  appendSessionMessage(record, message);
  syncSessionMeta(record); // 首条用户消息改题后同步自描述头
  const idx = order.indexOf(id);
  if (idx > 0) {
    order.splice(idx, 1);
    order.unshift(id);
  }
  persistIndex();
  syncSidebar();
}

/**
 * 渲染层乐观消息 id 透传：发送/编辑重发的乐观气泡 id 由渲染层先行生成并
 * 随 IPC 带上，主进程落账沿用同一 id——否则乐观气泡的本地 id 不在存储里，
 * 紧接着的编辑重发会因截断找不到消息而报 "message not found"。请求的 id
 * 为合法字符串且会话内未占用时采用；否则（旧渲染层不带 id、id 冲突）回退
 * 到本地生成。
 */
export function adoptMessageId(sessionId: string, requested: unknown): string {
  if (typeof requested === "string" && requested.length > 0 && requested.length <= 128) {
    const record = sessions.get(sessionId);
    if (record) {
      if (!record.messagesLoaded) hydrate(record);
      if (!record.messages.some((m) => m.id === requested)) return requested;
    }
  }
  return `msg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}_u`;
}

/**
 * 编辑重发的存储截断：删掉 fromMessageId（含）及其后所有消息，并按保留
 * 消息整档重写主转录（重启后 hydration 与运行时播种都以重写文件为准，
 * 被替换的轮次不会复活）。会话或消息不存在返回 undefined 由调用方报错。
 */
export function truncateMessagesFrom(id: string, fromMessageId: string): SessionRewind | undefined {
  const record = sessions.get(id);
  if (!record) return undefined;
  if (!record.messagesLoaded) hydrate(record);
  const rewind = truncateSessionMessages(record, fromMessageId);
  if (!rewind) return undefined;
  persistIndex();
  syncSidebar();
  rewriteSessionTranscript(fileMap.get(id) ?? null, rewind.keptMessages);
  metaOnDisk.delete(id); // 重写丢了 meta 行，强制补写
  syncSessionMeta(record);
  return rewind;
}

export function getSidebarState(): SidebarState {
  return sidebarStore?.getSidebarState() ?? {
    version: 1,
    order: [],
    archived: {},
    pinned: {},
    groups: [],
    ungrouped: [],
    projectOrder: [],
    manualProjectOrders: {},
    manualUngrouped: false,
    projects: [],
  };
}

export function archiveSession(id: string, archived: boolean): void {
  if (!sidebarStore) throw new Error("sidebar store not initialized");
  sidebarStore.archiveSession(id, archived);
}

export function pinSession(id: string, pinned: boolean): void {
  if (!sidebarStore) throw new Error("sidebar store not initialized");
  sidebarStore.pinSession(id, pinned);
}

export function reorderSessions(container: SidebarContainer, orderedIds: readonly string[]): void {
  if (!sidebarStore) throw new Error("sidebar store not initialized");
  sidebarStore.reorderSessions(container, orderedIds);
}

export function moveSession(id: string, target: SidebarContainer, beforeId?: string): void {
  if (!sidebarStore) throw new Error("sidebar store not initialized");
  sidebarStore.moveSession(id, target, beforeId);
}

export function reorderSidebarContainers(kind: "projects" | "groups", orderedIds: readonly string[]): void {
  if (!sidebarStore) throw new Error("sidebar store not initialized");
  sidebarStore.reorderContainers(kind, orderedIds);
}

export function upsertSidebarGroup(group: { id: string; name: string; collapsed?: boolean; sessionIds?: readonly string[]; color?: string }): void {
  if (!sidebarStore) throw new Error("sidebar store not initialized");
  sidebarStore.upsertSidebarGroup(group);
}

export function deleteSidebarGroup(id: string): void {
  if (!sidebarStore) throw new Error("sidebar store not initialized");
  sidebarStore.deleteSidebarGroup(id);
}

export function setSidebarGroupCollapsed(id: string, collapsed: boolean): void {
  if (!sidebarStore) throw new Error("sidebar store not initialized");
  sidebarStore.setSidebarGroupCollapsed(id, collapsed);
}

export function updateMessage(
  sessionId: string,
  messageId: string,
  patch: Partial<ChatMessage> | ((message: ChatMessage) => void),
): void {
  const record = sessions.get(sessionId);
  if (!record) return;
  updateSessionMessage(record, messageId, patch);
}
