// 编辑重发的存储截断：消息表 splice、转录按保留消息整档重写（turn-v2 行/
// 用户轮分组）、重启 hydration 只回放保留轮——被替换的轮次不得复活。全部
// 针对临时目录，不启动 electron。
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { encodeTurnV2 } from "@innocenceharness/harness-electron";
import { appendMessage, createSession, initSessionStore, listMessages, truncateMessagesFrom } from "./sessions";
import { sessionFileInTree, sessionsRoot } from "./sessionFiles";
import { messageText, type ChatMessage, type Session } from "../shared/ipc";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "ic-rewind-"));
  initSessionStore(dir);
});

function transcriptFile(session: Session): string {
  return sessionFileInTree(sessionsRoot(dir), session.id, session.createdAt);
}

function user(id: string, text: string, at = 1): ChatMessage {
  return { id, role: "user", parts: [{ type: "text", text }], createdAt: at };
}

function assistant(id: string, text: string, at = 2, completion = true): ChatMessage {
  return {
    id,
    role: "assistant",
    parts: [{ type: "text", text }],
    createdAt: at,
    ...(completion ? { completion: { finishReason: "stop" as const, aborted: false } } : {}),
  };
}

/** 直写主转录（turn-v2 行，与运行时 persistTurn 同形；覆盖创建期的 meta 行，
 *  hydration 后外观会自愈补写 session-meta）。 */
function writeTurnRows(session: Session, turns: Array<Array<{ role: "user" | "assistant"; parts: unknown[] }>>): void {
  const file = transcriptFile(session);
  writeFileSync(file, "", { flag: "w" }); // 确保目录存在（meta 已建）
  const lines = turns.map((messages, index) =>
    encodeTurnV2(`turn_${index}`, new Date(2026, 0, 1).toISOString(), messages as never, {
      finishReason: "stop",
      aborted: false,
    }),
  );
  writeFileSync(file, lines.join(""), "utf8");
}

describe("edit-resend store rewind", () => {
  it("截断被编辑消息起的存储消息，返回保留消息与用户轮数", () => {
    const s = createSession();
    appendMessage(s.id, user("u1", "第一问"));
    appendMessage(s.id, assistant("a1", "第一答"));
    appendMessage(s.id, user("u2", "第二问", 3));
    appendMessage(s.id, assistant("a2", "第二答", 4));

    const rewind = truncateMessagesFrom(s.id, "u2");

    expect(rewind?.keptMessages.map((m) => m.id)).toEqual(["u1", "a1"]);
    expect(rewind?.keptUserTurns).toBe(1);
    expect(listMessages(s.id).map((m) => m.id)).toEqual(["u1", "a1"]);
  });

  it("重写转录：重启 hydration 只回放保留轮，被替换轮次不复活", () => {
    const s = createSession();
    writeTurnRows(s, [
      [{ role: "user", parts: [{ type: "text", text: "第一问" }] }, { role: "assistant", parts: [{ type: "text", text: "第一答" }] }],
      [{ role: "user", parts: [{ type: "text", text: "第二问" }] }, { role: "assistant", parts: [{ type: "text", text: "第二答" }] }],
    ]);
    initSessionStore(dir); // restart → hydrate 出 msg_restored_* id
    const messages = listMessages(s.id);
    expect(messages.map((m) => messageText(m.parts))).toEqual(["第一问", "第一答", "第二问", "第二答"]);

    truncateMessagesFrom(s.id, messages[2]!.id);

    initSessionStore(dir); // restart → 只剩第一轮
    const after = listMessages(s.id);
    expect(after.map((m) => messageText(m.parts))).toEqual(["第一问", "第一答"]);
    // completion 随重写保留：重启后不会误判为中断轮（出现「继续」钮）。
    expect(after[1]!.completion?.finishReason).toBe("stop");
  });

  it("工具轮结构经重写往返保持（canonical 拆分后 hydration 再归并回助手气泡）", () => {
    const s = createSession();
    writeTurnRows(s, [
      [
        { role: "user", parts: [{ type: "text", text: "跑一下" }] },
        {
          role: "assistant",
          parts: [
            { type: "toolCall", id: "c1", toolName: "Bash", args: { command: "ls" } },
          ],
        },
        { role: "user", parts: [{ type: "toolResult", toolCallId: "c1", content: "ok", isError: false }] },
        { role: "assistant", parts: [{ type: "text", text: "好了" }] },
      ],
      [
        { role: "user", parts: [{ type: "text", text: "再跑" }] },
        { role: "assistant", parts: [{ type: "text", text: "又好了" }] },
      ],
    ]);
    initSessionStore(dir);
    const messages = listMessages(s.id);
    expect(messages.map((m) => m.role)).toEqual(["user", "assistant", "user", "assistant"]);

    // 截掉第二轮：第一轮（含工具结构）经重写后仍完整往返。
    truncateMessagesFrom(s.id, messages[2]!.id);

    initSessionStore(dir);
    const after = listMessages(s.id);
    expect(after.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(after[1]!.parts.map((p) => p.type)).toEqual(["toolCall", "toolResult", "text"]);
  });

  it("截到顶（首条用户消息）：转录重写为空文件，重启回放为空", () => {
    const s = createSession();
    writeTurnRows(s, [
      [{ role: "user", parts: [{ type: "text", text: "第一问" }] }, { role: "assistant", parts: [{ type: "text", text: "第一答" }] }],
    ]);
    initSessionStore(dir);

    truncateMessagesFrom(s.id, listMessages(s.id)[0]!.id);

    initSessionStore(dir);
    expect(listMessages(s.id)).toHaveLength(0);
    expect(existsSync(transcriptFile(s))).toBe(true);
  });

  it("live 直发消息（无既往转录）截断后转录从保留消息生成", () => {
    const s = createSession();
    appendMessage(s.id, user("u1", "第一问"));
    appendMessage(s.id, assistant("a1", "第一答"));
    appendMessage(s.id, user("u2", "第二问", 3));

    truncateMessagesFrom(s.id, "u2");

    initSessionStore(dir);
    const after = listMessages(s.id);
    expect(after.map((m) => messageText(m.parts))).toEqual(["第一问", "第一答"]);
  });

  it("未知消息 id 或未知会话返回 undefined，存储与转录原样", () => {
    const s = createSession();
    writeTurnRows(s, [
      [{ role: "user", parts: [{ type: "text", text: "第一问" }] }, { role: "assistant", parts: [{ type: "text", text: "第一答" }] }],
    ]);
    initSessionStore(dir);
    const turnRowsOf = (raw: string) =>
      raw.split("\n").filter((line) => line.trim() && !line.includes('"session-meta"'));
    const before = turnRowsOf(readFileSync(transcriptFile(s), "utf8"));

    expect(truncateMessagesFrom(s.id, "missing")).toBeUndefined();
    expect(truncateMessagesFrom("sess_missing", "u1")).toBeUndefined();

    // 轮行逐字节原样；允许 hydration 自愈追加 session-meta 自描述行。
    expect(turnRowsOf(readFileSync(transcriptFile(s), "utf8"))).toEqual(before);
    expect(listMessages(s.id)).toHaveLength(2);
  });
});
