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
import type { ChatMessage, MessagePart, Session } from "../shared/ipc";

export interface SessionForkOptions {
  /** 切口消息 id：必须是用户消息且含切口本身（其后的助手回复被丢弃，
   *  分叉后从该用户消息重新作答）。缺省 = 从最新状态整段分叉。 */
  upToMessageId?: string;
  /**
   * 工作树分叉模式（A:95）：在父会话工作区的 .innocence/worktrees/ 下自
   * 父当前 HEAD 建分离工作树，并把新会话绑定到该工作树——父工作树因会话
   * 根切换而天然禁入（路径约束拒越根）。非 Git 仓库或创建失败返回
   * undefined（显式模式不静默回退文本分叉）。
   */
  worktree?: boolean;
}

/** git 执行面（execFile，无 shell；与 tools-worktree 同口径）。 */
async function runGit(cwd: string, args: readonly string[]): Promise<string> {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const { stdout } = await promisify(execFile)("git", [...args], { cwd, encoding: "utf8" });
  return stdout;
}

/**
 * 工作树分叉：自父工作区当前 HEAD 建分离工作树并返回其绝对路径。失败
 * （非 Git 仓库/git 报错）返回 undefined。
 */
export async function createForkWorktree(
  parentWorkspaceRoot: string,
  forkId: string,
): Promise<string | undefined> {
  if (!parentWorkspaceRoot) return undefined;
  try {
    const inside = (
      await runGit(parentWorkspaceRoot, ["rev-parse", "--is-inside-work-tree"])
    ).trim();
    if (inside !== "true") return undefined;
    const relative = `.innocence/worktrees/fork_${forkId}`;
    await runGit(parentWorkspaceRoot, ["worktree", "add", "--detach", relative, "HEAD"]);
    return path.resolve(parentWorkspaceRoot, relative);
  } catch {
    return undefined;
  }
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
 * Seeds the fork's transcript (facade-resolved date-tree file) with the
 * prefix as one turn-v2 row. Empty prefixes write no file — the fork is then
 * indistinguishable from a fresh session (no file = never chatted). The
 * self-describing session-meta header is appended by the facade right after
 * this call. Completions are intentionally dropped: they are per-turn run
 * metadata, not conversational content.
 */
export function writeForkTranscript(file: string | null, prefix: readonly ChatMessage[]): void {
  if (prefix.length === 0 || !file) return;
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

/** 同上，但会话绑定到指定工作树根（A:95 工作树分叉模式）。 */
export function forkWorktreeSessionRecord(
  parent: SessionRecord,
  prefix: readonly ChatMessage[],
  input: { id: string; now: number; upToMessageId?: string; worktreeRoot: string },
): SessionRecord {
  const record = forkSessionRecord(parent, prefix, input);
  return { ...record, workspaceRoot: input.worktreeRoot, title: `${parent.title} · 工作树分叉` };
}

export type { Session };
