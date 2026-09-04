// Session fork (M1 会话 fork, 存储编排半边): prefix slicing at a user
// message, transcript seeding through the EXISTING hydration path, index
// lineage — all against a temp dir, no electron.
import fsp from "node:fs/promises";
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
import { sessionFileInTree, sessionsRoot } from "./sessionFiles";
import type { ChatMessage, Session } from "../shared/ipc";
import { messageText } from "../shared/ipc";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "ic-session-fork-"));
  initSessionStore(dir);
});

/** 分叉会话在 sessions 日期树里的主转录路径。 */
function forkFile(fork: Session): string {
  return sessionFileInTree(sessionsRoot(dir), fork.id, fork.createdAt);
}

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
  it("forks the whole history when no cut message is given", async () => {
    const parentId = seededParent();
    const fork = await forkSession(parentId);
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

  it("cuts inclusively at a user message and drops the following assistant reply", async () => {
    const parentId = seededParent();
    const fork = await forkSession(parentId, { upToMessageId: "u2" });
    expect(fork).toBeDefined();
    expect(fork!.forkedFrom).toEqual({ sessionId: parentId, messageId: "u2" });
    expect(listMessages(fork!.id).map((m) => messageText(m.parts))).toEqual([
      "第一问",
      "第一答",
      "第二问",
    ]);
  });

  it("rejects unknown ids and assistant ids as cut points", async () => {
    const parentId = seededParent();
    expect(await forkSession(parentId, { upToMessageId: "missing" })).toBeUndefined();
    expect(await forkSession(parentId, { upToMessageId: "a1" })).toBeUndefined();
    expect(await forkSession("no-such-session")).toBeUndefined();
  });

  it("writes a seed transcript file the hydration path replays", async () => {
    const parentId = seededParent();
    const fork = await forkSession(parentId, { upToMessageId: "u1" });
    const file = forkFile(fork!);
    expect(existsSync(file)).toBe(true);
    const raw = readFileSync(file, "utf8");
    expect(raw).toContain("第一问");
    expect(raw).not.toContain("第二问");
    // 重启（索引重建 + 懒 hydration）后分叉内容仍在。
    initSessionStore(dir);
    expect(listMessages(fork!.id).map((m) => messageText(m.parts))).toEqual(["第一问"]);
  });

  it("records fork lineage in the index and survives restart", async () => {
    const parentId = seededParent();
    const fork = await forkSession(parentId, { upToMessageId: "u2" });
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

  it("whole-history fork drops a trailing streaming partial", async () => {
    const parent = createSession({ title: "流式中" });
    appendMessage(parent.id, user("u1", "问"));
    appendMessage(parent.id, { ...assistant("a1", "写到一半"), streaming: true });
    const fork = await forkSession(parent.id);
    expect(listMessages(fork!.id).map((m) => messageText(m.parts))).toEqual(["问"]);
  });

  it("seed row replays through the runtime transcript decoder too", async () => {
    const { decodeTranscript } = await import("@innocenceharness/harness-electron");
    const parentId = seededParent();
    const fork = await forkSession(parentId, { upToMessageId: "u2" });
    const raw = readFileSync(forkFile(fork!), "utf8");
    const decoded = decodeTranscript(raw);
    expect(decoded.history.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
    // 种子行 + 自描述 session-meta 行（分叉创建即落盘）。
    expect(decoded.validRecords).toBe(2);
    expect(decoded.meta?.id).toBe(fork!.id);
    expect(decoded.meta?.forkedFrom).toEqual({ sessionId: parentId, messageId: "u2" });
  });

  it("forking an empty session yields an empty fork with only a self-describing meta file", async () => {
    const parent = createSession({ title: "空" });
    const fork = await forkSession(parent.id);
    expect(fork).toBeDefined();
    expect(listMessages(fork!.id)).toEqual([]);
    // 空分叉无轮行，但创建即自描述（meta-only 文件 = 从未聊过，非损坏）。
    const file = forkFile(fork!);
    expect(existsSync(file)).toBe(true);
    const { decodeTranscript } = await import("@innocenceharness/harness-electron");
    const decoded = decodeTranscript(readFileSync(file, "utf8"));
    expect(decoded.meta?.id).toBe(fork!.id);
    expect(decoded.history).toEqual([]);
  });

  it("fork of a fork chains lineage to its own parent", async () => {
    const parentId = seededParent();
    const first = await forkSession(parentId, { upToMessageId: "u2" });
    appendMessage(first!.id, user("u3", "分叉后新问"));
    appendMessage(first!.id, assistant("a3", "分叉后新答"));
    const second = await forkSession(first!.id, { upToMessageId: "u3" });
    expect(second).toBeDefined();
    expect(second!.forkedFrom).toEqual({ sessionId: first!.id, messageId: "u3" });
    expect(listMessages(second!.id).map((m) => messageText(m.parts))).toEqual([
      "第一问",
      "第一答",
      "第二问",
      "分叉后新问",
    ]);
  });

  it("keeps tool parts through a fork", async () => {
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
    const fork = await forkSession(parent.id);
    const messages = listMessages(fork!.id);
    expect(messages).toHaveLength(2);
    expect(messages[1]?.parts.map((p) => p.type)).toEqual(["toolCall", "toolResult", "text"]);
  });
});

describe("worktree fork mode (A:95)", () => {
  async function gitRepo(): Promise<string> {
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const run = promisify(execFile);
    const dir = await fsp.mkdtemp(path.join(tmpdir(), "ic-fork-wt-"));
    await run("git", ["init", "-q", "."], { cwd: dir });
    await fsp.writeFile(path.join(dir, "a.txt"), "committed\n", "utf8");
    await run("git", ["add", "."], { cwd: dir });
    await run(
      "git",
      ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init"],
      { cwd: dir },
    );
    return dir;
  }

  it("binds the fork session to a detached worktree of the parent HEAD", async () => {
    const repo = await gitRepo();
    const parent = createSession({ title: "父", workspaceRoot: repo });
    appendMessage(parent.id, user("u1", "问"));
    appendMessage(parent.id, assistant("a1", "答"));
    const fork = await await forkSession(parent.id, { upToMessageId: "u1", worktree: true });
    expect(fork).toBeDefined();
    expect(fork!.title).toContain("工作树分叉");
    const root = fork!.workspaceRoot ?? "";
    expect(root.replace(/\\/g, "/")).toContain(".innocence/worktrees/fork_");
    // 工作树真实存在且含父 HEAD 的内容；父检出不受影响。
    const stat = await fsp.stat(path.join(root, "a.txt"));
    expect(stat.isFile()).toBe(true);
    // 会话内历史照常回放。
    expect(listMessages(fork!.id).map((m) => messageText(m.parts))).toEqual(["问"]);
  });

  it("a non-git parent workspace yields undefined (no silent text fallback)", async () => {
    const plain = await fsp.mkdtemp(path.join(tmpdir(), "ic-fork-plain-"));
    const parent = createSession({ title: "非Git", workspaceRoot: plain });
    appendMessage(parent.id, user("u1", "问"));
    const fork = await await forkSession(parent.id, { upToMessageId: "u1", worktree: true });
    expect(fork).toBeUndefined();
  });
});
