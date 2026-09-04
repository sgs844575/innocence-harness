// Session index I/O responsibility of the session facade: the sessions.json
// file format, atomic rewrites and defensive loads (corrupt index moves aside
// instead of crashing boot). The in-memory records/order live in sessions.ts —
// this module owns the persisted shape only, and stays electron-free.
import fs from "node:fs";
import path from "node:path";
import type { ChatMessage, Session } from "../shared/ipc";

/** Full in-memory record: the public view plus lazily hydrated message bodies. */
export interface SessionRecord extends Session {
  messages: ChatMessage[];
  /** False for index-restored sessions until their transcript has been read. */
  messagesLoaded: boolean;
  /**
   * 主转录文件相对 sessions 根的路径（YYYY/MM/DD/<id>.jsonl）。索引可由
   * sessions/ 树扫描重建 —— 本字段只是跨启动稳定提示，读取以扫描/映射为准。
   */
  file?: string;
}

/** Persisted index shape (one entry per session; messages never live here). */
export interface SessionIndexEntry {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
  /** 会话绑定的项目根；旧索引缺省为空串。 */
  workspaceRoot?: string;
  /** M1 会话 fork 血缘：父会话与切口消息（信息性，不参与装载逻辑）。 */
  forkedFrom?: { sessionId: string; messageId?: string };
  /** dock 辅助对话会话标记（缺省 = 普通会话）。 */
  aux?: boolean;
  /** 主转录文件相对路径（见 SessionRecord.file）。 */
  file?: string;
}

/** <storeDir>/sessions.json; null while the store has no directory. */
export function sessionIndexFile(storeDir: string | null): string | null {
  return storeDir ? path.join(storeDir, "sessions.json") : null;
}

/** Strips the lazy-loading internals off a record for public consumers. */
export function publicSessionView(record: SessionRecord): Session {
  const { messages: _messages, messagesLoaded: _loaded, ...rest } = record;
  return { ...rest };
}

/** Index entry for one record (order is owned by the facade). */
export function sessionIndexEntryOf(record: SessionRecord): SessionIndexEntry {
  return {
    id: record.id,
    title: record.title,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    messageCount: record.messageCount,
    workspaceRoot: record.workspaceRoot,
    ...(record.file ? { file: record.file } : {}),
    ...(record.forkedFrom ? { forkedFrom: { ...record.forkedFrom } } : {}),
    ...(record.aux === true ? { aux: true } : {}),
  };
}

/** Atomic index rewrite (tmp + rename); best-effort, never breaks a chat turn. */
export function persistSessionIndex(file: string | null, entries: readonly SessionIndexEntry[]): void {
  if (!file) return;
  try {
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(entries, null, 2), "utf8");
    fs.renameSync(tmp, file);
  } catch {
    // Losing the index write must not fail the mutation itself.
  }
}

/**
 * Loads the persisted index defensively: unparseable or non-array content
 * moves the file aside (`.corrupt-<ts>`) and yields an empty list rather
 * than crashing at boot; every entry is re-validated field by field.
 */
export function loadSessionIndex(file: string | null): SessionIndexEntry[] {
  if (!file) return [];
  let entries: SessionIndexEntry[];
  try {
    entries = JSON.parse(fs.readFileSync(file, "utf8")) as SessionIndexEntry[];
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      // Corrupt index: move it aside instead of crashing at boot.
      try {
        fs.renameSync(file, `${file}.corrupt-${Date.now()}`);
      } catch {
        // Nothing sensible left to do — start empty.
      }
    }
    return [];
  }
  return Array.isArray(entries) ? entries : [];
}

/** Fresh, not-yet-hydrated record for one index entry (defensive field mapping). */
export function sessionRecordFromEntry(e: SessionIndexEntry): SessionRecord {
  const forked = e.forkedFrom;
  return {
    id: e.id,
    title: typeof e.title === "string" ? e.title : "新会话",
    createdAt: typeof e.createdAt === "number" ? e.createdAt : Date.now(),
    updatedAt: typeof e.updatedAt === "number" ? e.updatedAt : Date.now(),
    messageCount: typeof e.messageCount === "number" ? e.messageCount : 0,
    workspaceRoot: typeof e.workspaceRoot === "string" ? e.workspaceRoot : "",
    ...(typeof e.file === "string" && e.file ? { file: e.file } : {}),
    ...(e.aux === true ? { aux: true } : {}),
    ...(forked && typeof forked === "object" && typeof forked.sessionId === "string"
      ? {
          forkedFrom: {
            sessionId: forked.sessionId,
            ...(typeof forked.messageId === "string" ? { messageId: forked.messageId } : {}),
          },
        }
      : {}),
    messages: [],
    messagesLoaded: false,
  };
}
