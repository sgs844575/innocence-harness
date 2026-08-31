// Session store facade: owns the in-memory session table (order + records)
// and assembles the three responsibilities behind the stable exports —
// sessionIndexStore.ts (index I/O), sessionHydration.ts (lazy transcript
// hydration incl. corrupt-transcript self-heal), sessionMessages.ts (message
// mutation). The module stays electron-free so vitest can exercise it
// directly; initSessionStore(dir) runs once from the main entry.
import fs from "node:fs";
import {
  loadSessionIndex,
  persistSessionIndex,
  publicSessionView,
  sessionIndexEntryOf,
  sessionIndexFile,
  sessionRecordFromEntry,
  sessionTranscriptFile,
  type SessionRecord,
} from "./sessionIndexStore";
import { hydrateSessionMessages } from "./sessionHydration";
import { appendSessionMessage, updateSessionMessage } from "./sessionMessages";
import {
  createForkWorktree,
  forkMessagePrefix,
  forkSessionRecord,
  forkWorktreeSessionRecord,
  writeForkTranscript,
  type SessionForkOptions,
} from "./sessionFork";
import { createSidebarIndexStore, type SidebarIndexStore, type SidebarState } from "./sidebarIndexStore";
import type { SidebarContainer } from "../shared/sidebarIpc";
import type { ChatMessage, Session } from "../shared/ipc";

export type { SessionRecord } from "./sessionIndexStore";

const sessions = new Map<string, SessionRecord>();
// Newest first when listing, mirroring a typical chat sidebar.
const order: string[] = [];
let storeDir: string | null = null;
let sidebarStore: SidebarIndexStore | null = null;

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

function hydrate(record: SessionRecord): void {
  hydrateSessionMessages(record, {
    transcriptFile: sessionTranscriptFile(storeDir, record.id),
    persistIndex,
  });
}

/** Loads the persisted index; call once at app start (idempotent, for tests). */
export function initSessionStore(userDataDir: string): void {
  storeDir = userDataDir;
  sessions.clear();
  order.length = 0;
  for (const e of loadSessionIndex(sessionIndexFile(storeDir))) {
    if (!e || typeof e.id !== "string") continue;
    sessions.set(e.id, sessionRecordFromEntry(e));
    order.push(e.id);
  }
  sidebarStore = createSidebarIndexStore(storeDir, currentSidebarSessions());
  syncSidebar();
}

export function listSessions(): Session[] {
  return order.map((id) => publicSessionView(sessions.get(id)!));
}

export function createSession(options?: { title?: string; workspaceRoot?: string }): Session {
  const id = `sess_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const now = Date.now();
  const record: SessionRecord = {
    id,
    title: options?.title?.trim() || "新会话",
    createdAt: now,
    updatedAt: now,
    messageCount: 0,
    workspaceRoot: options?.workspaceRoot ?? "",
    messages: [],
    messagesLoaded: true, // Fresh session: nothing on disk to restore.
  };
  sessions.set(id, record);
  order.unshift(id);
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
  const file = sessionTranscriptFile(storeDir, id);
  if (file) {
    try {
      fs.rmSync(file, { force: true });
    } catch {
      // Transcript removal is best-effort; the session itself is gone.
    }
  }
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
  writeForkTranscript(storeDir, id, prefix);
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
  sessions.set(id, record);
  order.unshift(id);
  persistIndex();
  syncSidebar();
  return publicSessionView(record);
}

export function getSession(id: string): SessionRecord | undefined {
  return sessions.get(id);
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
  const idx = order.indexOf(id);
  if (idx > 0) {
    order.splice(idx, 1);
    order.unshift(id);
  }
  persistIndex();
  syncSidebar();
}

export function getSidebarState(): SidebarState {
  return sidebarStore?.getSidebarState() ?? {
    version: 1,
    order: [],
    archived: {},
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

export function upsertSidebarGroup(group: { id: string; name: string; collapsed?: boolean; sessionIds?: readonly string[] }): void {
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
