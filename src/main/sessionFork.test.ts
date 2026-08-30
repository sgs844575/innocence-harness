// Session fork (M1 会话 fork, 存储编排半边): prefix slicing at a user
// message, transcript seeding through the EXISTING hydration path, index
// lineage — all against a temp dir, no electron.
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import {
  appendMessage,
  createSession,
  forkSession,
  initSessionStore,
  listMessages,
} from "./sessions";
import type { ChatMessage } from "../shared/ipc";
import { messageText } from "../shared/ipc";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "ic-session-fork-"));
  initSessionStore(dir);
});

function user(id: string, text: string): ChatMessage {
  return { id, role: "user", parts: [{ type: "text", text }], createdAt: 1 };
}

function assistant(id: string, text: string): ChatMessage {
  return { id, role: "assistant", parts: [{ type: "text", text }], createdAt: 2 };
}

function seededParent(): string {
  const parent = createSession({ title: "父会话", workspaceRoot: "D:/proj" });
  appendMessage(parent.id, user("u1", "第一问"));
  appendMessage(parent.id, assistant("a1", "第一答"));
  appendMessage(parent.id, user("u2", "第二问"));
  appendMessage(parent.id, assistant("a2", "第二答"));
  return parent.id;
}

describe("session fork store (M1)", () => {
  it("forks the whole history when no cut message is given", () => {
    const parentId = seededParent();
    const fork = forkSession(parentId);
    expect(fork).toBeDefined();
    expect(fork!.title).toBe("父会话 · 分叉");
    expect(fork!.workspaceRoot).toBe("D:/proj");
    expect(fork!.forkedFrom).toEqual({ sessionId: parentId });
    expect(listMessages(fork!.id).map((m) => messageText(m.parts))).toEqual([
      "第一问",
      "第一答",
      "第二问",
      "第二答",
    ]);
  });

  it("cuts inclusively at a user message and drops the following assistant reply", () => {
    const parentId = seededParent();
    const fork = forkSession(parentId, { upToMessageId: "u2" });
    expect(fork).toBeDefined();
    expect(fork!.forkedFrom).toEqual({ sessionId: parentId, messageId: "u2" });
    expect(listMessages(fork!.id).map((m) => messageText(m.parts))).toEqual([
      "第一问",
      "第一答",
      "第二问",
    ]);
  });

  it("rejects unknown ids and assistant ids as cut points", () => {
    const parentId = seededParent();
    expect(forkSession(parentId, { upToMessageId: "missing" })).toBeUndefined();
    expect(forkSession(parentId, { upToMessageId: "a1" })).toBeUndefined();
    expect(forkSession("no-such-session")).toBeUndefined();
  });

  it("writes a seed transcript file the hydration path replays", () => {
    const parentId = seededParent();
    const fork = forkSession(parentId, { upToMessageId: "u1" });
    const file = path.join(dir, "transcripts", `${fork!.id}.jsonl`);
    expect(existsSync(file)).toBe(true);
    const raw = readFileSync(file, "utf8");
    expect(raw).toContain("第一问");
    expect(raw).not.toContain("第二问");
    // 重启（索引重建 + 懒 hydration）后分叉内容仍在。
    initSessionStore(dir);
    expect(listMessages(fork!.id).map((m) => messageText(m.parts))).toEqual(["第一问"]);
  });

  it("records fork lineage in the index and survives restart", () => {
    const parentId = seededParent();
    const fork = forkSession(parentId, { upToMessageId: "u2" });
    initSessionStore(dir);
    const restored = fork;
    expect(restored).toBeDefined();
    const index = JSON.parse(readFileSync(path.join(dir, "sessions.json"), "utf8")) as Array<{
      id: string;
      forkedFrom?: { sessionId: string; messageId?: string };
    }>;
    const entry = index.find((e) => e.id === fork!.id);
    expect(entry?.forkedFrom).toEqual({ sessionId: parentId, messageId: "u2" });
  });

  it("whole-history fork drops a trailing streaming partial", () => {
    const parent = createSession({ title: "流式中" });
    appendMessage(parent.id, user("u1", "问"));
    appendMessage(parent.id, { ...assistant("a1", "写到一半"), streaming: true });
    const fork = forkSession(parent.id);
    expect(listMessages(fork!.id).map((m) => messageText(m.parts))).toEqual(["问"]);
  });

  it("seed row replays through the runtime transcript decoder too", async () => {
    const { decodeTranscript } = await import("@innocenceharness/harness-electron");
    const parentId = seededParent();
    const fork = forkSession(parentId, { upToMessageId: "u2" });
    const raw = readFileSync(path.join(dir, "transcripts", `${fork!.id}.jsonl`), "utf8");
    const decoded = decodeTranscript(raw);
    expect(decoded.history.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
    expect(decoded.validRecords).toBe(1);
  });

  it("forking an empty session yields an empty fork without a transcript file", () => {
    const parent = createSession({ title: "空" });
    const fork = forkSession(parent.id);
    expect(fork).toBeDefined();
    expect(listMessages(fork!.id)).toEqual([]);
    expect(existsSync(path.join(dir, "transcripts", `${fork!.id}.jsonl`))).toBe(false);
  });

  it("fork of a fork chains lineage to its own parent", () => {
    const parentId = seededParent();
    const first = forkSession(parentId, { upToMessageId: "u2" });
    appendMessage(first!.id, user("u3", "分叉后新问"));
    appendMessage(first!.id, assistant("a3", "分叉后新答"));
    const second = forkSession(first!.id, { upToMessageId: "u3" });
    expect(second).toBeDefined();
    expect(second!.forkedFrom).toEqual({ sessionId: first!.id, messageId: "u3" });
    expect(listMessages(second!.id).map((m) => messageText(m.parts))).toEqual([
      "第一问",
      "第一答",
      "第二问",
      "分叉后新问",
    ]);
  });

  it("keeps tool parts through a fork", () => {
    const parent = createSession({ title: "工具" });
    appendMessage(parent.id, user("u1", "查一下"));
    appendMessage(parent.id, {
      id: "a1",
      role: "assistant",
      parts: [
        { type: "toolCall", id: "tc1", toolName: "Read", args: { path: "a.ts" } },
        { type: "toolResult", toolCallId: "tc1", content: "内容", isError: false },
        { type: "text", text: "结论" },
      ],
      createdAt: 2,
    });
    const fork = forkSession(parent.id);
    const messages = listMessages(fork!.id);
    expect(messages).toHaveLength(2);
    expect(messages[1]?.parts.map((p) => p.type)).toEqual(["toolCall", "toolResult", "text"]);
  });
});
