// 编辑重发的存储半边（electron-free，可直接 vitest）：按消息 id 截断会话
// 记录的消息表，并把主转录文件按保留消息整档重写成 turn-v2 行——存储是唯一
// 事实源，重启后的 hydration 与运行时历史播种都从这份重写文件读，被替换的
// 轮次不会再复活。轮边界与 hydration 同构：带文本的 user 消息开轮。
import fs from "node:fs";
import path from "node:path";
import { encodeTurnV2 } from "@innocenceharness/harness-electron";
import type { SessionRecord } from "./sessionIndexStore";
import type { ChatMessage } from "../shared/ipc";

export interface SessionRewind {
  /** 截断点之前保留的消息（供调用方重写转录与计算内存回退锚点）。 */
  keptMessages: ChatMessage[];
  /** 保留消息里的用户轮数（带文本 user 消息计数，与运行时回退同构）。 */
  keptUserTurns: number;
}

/** 带文本的 user 消息 = 一轮的开始（工具结果 user 轮无文本，不开轮）。 */
function startsUserTurn(message: ChatMessage): boolean {
  return message.role === "user" && message.parts.some((p) => p.type === "text" && p.text.length > 0);
}

/** Splices `fromMessageId` (inclusive) and everything after it off the record. */
export function truncateSessionMessages(record: SessionRecord, fromMessageId: string): SessionRewind | undefined {
  const index = record.messages.findIndex((m) => m.id === fromMessageId);
  if (index < 0) return undefined;
  const keptMessages = record.messages.slice(0, index);
  record.messages.splice(0, record.messages.length, ...keptMessages);
  record.messageCount = record.messages.length;
  record.updatedAt = Date.now();
  return {
    keptMessages,
    keptUserTurns: keptMessages.filter(startsUserTurn).length,
  };
}

/**
 * Rewrites the session's main transcript from the kept store messages: one
 * turn-v2 row per user-turn group (the same grouping hydration folds back),
 * atomic tmp+rename. An empty kept list writes an empty file — "never chatted"
 * — so a rewound-to-top session hydrates empty. Best-effort like every other
 * transcript write: failures never break the resend turn itself.
 */
export function rewriteSessionTranscript(file: string | null, kept: readonly ChatMessage[]): void {
  if (!file) return;
  try {
    const lines: string[] = [];
    let group: ChatMessage[] = [];
    for (const message of kept) {
      if (startsUserTurn(message) && group.length > 0) {
        lines.push(encodeGroup(group));
        group = [];
      }
      group.push(message);
    }
    if (group.length > 0) lines.push(encodeGroup(group));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, lines.join(""), "utf8");
    fs.renameSync(tmp, file);
  } catch {
    // 转录重写是尽力而为：失败只影响重启后的历史回放，不当场打断重发。
  }
}

function encodeGroup(group: readonly ChatMessage[]): string {
  const last = group[group.length - 1]!;
  const completion = [...group].reverse().find((m) => m.role === "assistant" && m.completion)?.completion;
  const turnId = `turn_${last.createdAt.toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  return encodeTurnV2(
    turnId,
    new Date(last.createdAt).toISOString(),
    group.map((m) => ({ role: m.role, parts: m.parts })),
    completion,
  );
}
