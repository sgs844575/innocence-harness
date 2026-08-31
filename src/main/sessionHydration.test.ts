// 会话水合（重开应用恢复历史）的两个回放契约：
//   1. 组合用户轮里的 <system-reminder> 注入段必须剥掉——它们属于请求组装，
//      不是用户输入，回放进气泡等于把提示词暴露给用户。
//   2. 助手气泡以轮（completion）为界归并：同一轮内的工具轮并入一条，
//      跨轮（重试/续跑，中间没有用户消息）必须另起气泡——否则两轮合一，
//      用户重开应用后看起来"少了一段回复"。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { hydrateSessionMessages } from "./sessionHydration";
import type { SessionRecord } from "./sessionIndexStore";
import type { ChatMessage } from "../shared/ipc";

let dir: string;
let persisted = 0;
const persistIndex = () => {
  persisted += 1;
};

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ih-hydrate-"));
  persisted = 0;
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function writeTranscript(rows: Record<string, unknown>[]): string {
  const file = path.join(dir, "transcript.jsonl");
  fs.writeFileSync(file, rows.map((row) => JSON.stringify(row)).join("\n"), "utf8");
  return file;
}

function record(): SessionRecord {
  return {
    id: "s1",
    title: "t",
    createdAt: 1,
    updatedAt: 1,
    messageCount: 0,
    workspaceRoot: "",
    messages: [],
    messagesLoaded: false,
  };
}

/** turn 级 completion（codec 解码后挂到该轮最后一个 assistant 块）。 */
const completion = { providerId: "p", modelId: "m", finishReason: "stop" as const, aborted: false };

function textsOf(message: ChatMessage): string {
  return message.parts
    .filter((p) => p.type === "text")
    .map((p) => (p as { text: string }).text)
    .join("|");
}

describe("hydrateSessionMessages", () => {
  it("strips <system-reminder> injections from restored user turns", () => {
    const file = writeTranscript([
      {
        at: "2026-08-31T00:00:00.000Z",
        type: "turn-v2",
        turnId: "t1",
        completion,
        messages: [
          {
            role: "user",
            parts: [
              { type: "text", text: "你是？" },
              { type: "text", text: "<system-reminder>\nprovider context\n</system-reminder>" },
              { type: "text", text: "<system-reminder>\ntoken usage notice\n</system-reminder>" },
            ],
          },
          { role: "assistant", parts: [{ type: "text", text: "答" }] },
        ],
      },
    ]);
    const rec = record();
    hydrateSessionMessages(rec, { transcriptFile: file, persistIndex });
    const users = rec.messages.filter((m) => m.role === "user");
    expect(users.map(textsOf)).toEqual(["你是？"]);
    expect(rec.messages.some((m) => m.role === "assistant")).toBe(true);
  });

  it("keeps the user's own text even when an envelope precedes it", () => {
    const file = writeTranscript([
      {
        at: "2026-08-31T00:00:00.000Z",
        type: "turn-v2",
        turnId: "t1",
        completion,
        messages: [
          {
            role: "user",
            parts: [
              { type: "text", text: "<system-reminder>\nleading envelope\n</system-reminder>" },
              { type: "text", text: "真实输入" },
            ],
          },
          { role: "assistant", parts: [{ type: "text", text: "答" }] },
        ],
      },
    ]);
    const rec = record();
    hydrateSessionMessages(rec, { transcriptFile: file, persistIndex });
    // 首个 text 若是信封注入同样剥掉；其后第一段真实文本保留。
    expect(rec.messages.filter((m) => m.role === "user").map(textsOf)).toEqual(["真实输入"]);
  });

  it("starts a new assistant bubble per turn boundary (completion), keeping retry turns separate", () => {
    const file = writeTranscript([
      {
        at: "2026-08-31T00:00:00.000Z",
        type: "turn-v2",
        turnId: "t1",
        completion,
        messages: [
          { role: "user", parts: [{ type: "text", text: "问" }] },
          { role: "assistant", parts: [{ type: "text", text: "第一答" }] },
        ],
      },
      {
        at: "2026-08-31T00:01:00.000Z",
        type: "turn-v2",
        turnId: "t2",
        completion,
        // 重试轮：无用户消息分隔，直接从 assistant 开始。
        messages: [
          { role: "assistant", parts: [{ type: "text", text: "重试中途" }] },
          { role: "user", parts: [{ type: "toolResult", toolCallId: "c1", content: "r", isError: false }] },
          { role: "assistant", parts: [{ type: "text", text: "重试终答" }] },
        ],
      },
    ]);
    const rec = record();
    hydrateSessionMessages(rec, { transcriptFile: file, persistIndex });
    const assistants = rec.messages.filter((m) => m.role === "assistant");
    expect(assistants).toHaveLength(2);
    // 轮内归并：重试轮的工具结果并入该轮气泡，两段文本都在。
    expect(textsOf(assistants[0]!)).toBe("第一答");
    expect(textsOf(assistants[1]!)).toBe("重试中途|重试终答");
    expect(assistants[1]!.parts.some((p) => p.type === "toolResult")).toBe(true);
    expect(assistants[1]!.completion?.finishReason).toBe("stop");
  });

  it("merges intra-turn assistant blocks into one bubble", () => {
    const file = writeTranscript([
      {
        at: "2026-08-31T00:00:00.000Z",
        type: "turn-v2",
        turnId: "t1",
        completion,
        messages: [
          { role: "user", parts: [{ type: "text", text: "问" }] },
          { role: "assistant", parts: [{ type: "text", text: "先看结构" }, { type: "toolCall", id: "c1", toolName: "Bash", args: {} }] },
          { role: "user", parts: [{ type: "toolResult", toolCallId: "c1", content: "out", isError: false }] },
          { role: "assistant", parts: [{ type: "text", text: "结论" }] },
        ],
      },
    ]);
    const rec = record();
    hydrateSessionMessages(rec, { transcriptFile: file, persistIndex });
    const assistants = rec.messages.filter((m) => m.role === "assistant");
    expect(assistants).toHaveLength(1);
    expect(assistants[0]!.parts.map((p) => p.type)).toEqual(["text", "toolCall", "toolResult", "text"]);
  });
});
