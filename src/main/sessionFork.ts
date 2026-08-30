// Session fork responsibility of the session facade (M1 会话 fork，存储
// 编排半边): slices a parent session's hydrated history at a user message and
// seeds a NEW session's transcript so the EXISTING hydration and runtime
// seeding paths replay it — no new persistence protocol. Worktree-isolation
// semantics for forks belong to the S2 agent-operable worktree face and are
// deliberately absent here. Stays electron-free like its sibling modules.
import fs from "node:fs";
import path from "node:path";
import { encodeTurnV2 } from "@innocenceharness/harness-electron";
import type { Message, MessagePart as CanonicalPart } from "@innocenceharness/harness-session";
import type { SessionRecord } from "./sessionIndexStore";
import { sessionTranscriptFile } from "./sessionIndexStore";
import type { ChatMessage, MessagePart, Session } from "../shared/ipc";

export interface SessionForkOptions {
  /** 切口消息 id：必须是用户消息且含切口本身（其后的助手回复被丢弃，
   *  分叉后从该用户消息重新作答）。缺省 = 从最新状态整段分叉。 */
  upToMessageId?: string;
}

/**
 * Prefix of the hydrated history a fork seeds from. undefined = invalid cut
 * (unknown id, or the id is not a user message — assistant replies are not
 * fork points). The no-id whole-history branch drops a trailing streaming
 * assistant partial: baking half-finished text into a seed would present
 * truncated content as complete.
 */
export function forkMessagePrefix(
  messages: readonly ChatMessage[],
  upToMessageId?: string,
): readonly ChatMessage[] | undefined {
  if (upToMessageId === undefined) {
    const last = messages[messages.length - 1];
    if (last?.role === "assistant" && last.streaming === true) {
      return messages.slice(0, -1);
    }
    return messages;
  }
  const cut = messages.findIndex((m) => m.id === upToMessageId);
  if (cut < 0) return undefined;
  if (messages[cut]?.role !== "user") return undefined;
  return messages.slice(0, cut + 1);
}

/** 渲染层 part → 转录正典 part（durationMs 不在正典模型中，丢弃）。 */
function toCanonicalPart(part: MessagePart): CanonicalPart {
  if (part.type === "text" || part.type === "thinking") {
    return { type: part.type, text: part.text };
  }
  if (part.type === "toolCall") {
    return { type: "toolCall", id: part.id, toolName: part.toolName, args: part.args };
  }
  return {
    type: "toolResult",
    toolCallId: part.toolCallId,
    content: part.content,
    isError: part.isError,
  };
}

function toCanonicalMessage(message: ChatMessage): Message {
  return { role: message.role, parts: message.parts.map(toCanonicalPart) };
}

/**
 * Seeds the fork's transcript with the prefix as one turn-v2 row. Empty
 * prefixes write no file — the fork is then indistinguishable from a fresh
 * session (no file = never chatted). Completions are intentionally dropped:
 * they are per-turn run metadata, not conversational content.
 */
export function writeForkTranscript(
  storeDir: string | null,
  forkId: string,
  prefix: readonly ChatMessage[],
): void {
  if (prefix.length === 0) return;
  const file = sessionTranscriptFile(storeDir, forkId);
  if (!file) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const row = encodeTurnV2(
    `fork_${Date.now().toString(36)}`,
    new Date().toISOString(),
    prefix.map(toCanonicalMessage),
  );
  fs.writeFileSync(file, row, "utf8");
}

/** The fork's store record; the facade registers/orders/persists it. */
export function forkSessionRecord(
  parent: SessionRecord,
  prefix: readonly ChatMessage[],
  input: { id: string; now: number; upToMessageId?: string },
): SessionRecord {
  return {
    id: input.id,
    title: `${parent.title} · 分叉`,
    createdAt: input.now,
    updatedAt: input.now,
    messageCount: prefix.length,
    workspaceRoot: parent.workspaceRoot,
    messages: [],
    // 懒加载：读取我们刚写的种子文件，与重启恢复同路径。
    messagesLoaded: false,
    forkedFrom: {
      sessionId: parent.id,
      ...(input.upToMessageId ? { messageId: input.upToMessageId } : {}),
    },
  };
}

export type { Session };
