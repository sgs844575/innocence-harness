// 子代理档案 sidecar（subagentHistoryStore）直测：delta 不落盘、回放读回、
// 坏行防御与删除清理。临时目录隔离，不触碰真实 userData。
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  appendSubagentHistoryEvent,
  deleteSubagentHistory,
  readSubagentHistory,
  subagentHistoryFile,
} from "./subagentHistoryStore";
import type { SubagentLifecycleEvent } from "../shared/ipc";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "ic-subagent-history-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const started: SubagentLifecycleEvent = {
  childId: "c1",
  parentSessionId: "s1",
  description: "定位渲染",
  status: "started",
  agentType: "explore",
  prompt: "去查",
  parentInvocationId: "inv-1",
};

describe("subagentHistoryStore", () => {
  it("档案路径与主转录同目录（<id>.subagents.jsonl）；null 主文件无路径", () => {
    const mainFile = path.join(dir, "2026", "09", "04", "s1.jsonl");
    expect(subagentHistoryFile(mainFile, "s1")).toBe(path.join(dir, "2026", "09", "04", "s1.subagents.jsonl"));
    expect(subagentHistoryFile(null, "s1")).toBeNull();
  });

  it("追加事件按序落盘并可读回；delta/thinkingDelta 事件不落盘，textSegment/thinkingSegment 落盘", () => {
    const mainFile = path.join(dir, "2026", "09", "04", "s1.jsonl");
    const file = subagentHistoryFile(mainFile, "s1")!;
    appendSubagentHistoryEvent(file, started, 1000);
    appendSubagentHistoryEvent(file, { childId: "c1", parentSessionId: "s1", description: "", status: "running", delta: "流式增量" }, 1100);
    appendSubagentHistoryEvent(file, { childId: "c1", parentSessionId: "s1", description: "", status: "running", thinkingDelta: "推理增量" }, 1150);
    appendSubagentHistoryEvent(file, { childId: "c1", parentSessionId: "s1", description: "", status: "running", textSegment: "已闭合正文段" }, 1200);
    appendSubagentHistoryEvent(file, { childId: "c1", parentSessionId: "s1", description: "", status: "running", thinkingSegment: "已闭合思考段" }, 1250);
    appendSubagentHistoryEvent(
      file,
      { childId: "c1", parentSessionId: "s1", description: "", status: "running", tool: { name: "Edit", phase: "call", title: "a.ts", args: { file_path: "src/a.ts" } } },
      1300,
    );
    appendSubagentHistoryEvent(file, { childId: "c1", parentSessionId: "s1", description: "", status: "completed", final: "报告" }, 5000);
    const entries = readSubagentHistory(file);
    expect(entries).toHaveLength(5);
    expect(entries[0]).toEqual({ at: 1000, event: started });
    expect(entries[1]).toEqual({
      at: 1200,
      event: { childId: "c1", parentSessionId: "s1", description: "", status: "running", textSegment: "已闭合正文段" },
    });
    expect(entries[2]).toEqual({
      at: 1250,
      event: { childId: "c1", parentSessionId: "s1", description: "", status: "running", thinkingSegment: "已闭合思考段" },
    });
    expect(entries[3]).toEqual({
      at: 1300,
      event: { childId: "c1", parentSessionId: "s1", description: "", status: "running", tool: { name: "Edit", phase: "call", title: "a.ts", args: { file_path: "src/a.ts" } } },
    });
    expect(entries[4]).toEqual({ at: 5000, event: { childId: "c1", parentSessionId: "s1", description: "", status: "completed", final: "报告" } });
  });

  it("缺文件返回空；坏行/不完整行跳过，好行仍可回放", () => {
    const mainFile = path.join(dir, "2026", "09", "04", "s1.jsonl");
    expect(readSubagentHistory(subagentHistoryFile(path.join(dir, "none.jsonl"), "none"))).toEqual([]);
    const file = subagentHistoryFile(mainFile, "s1")!;
    appendSubagentHistoryEvent(file, started, 1000);
    writeFileSync(file, "{ 截断行\n{\"at\":\"x\"}\n" + readFileSync(file, "utf8"), "utf8");
    const entries = readSubagentHistory(file);
    expect(entries).toEqual([{ at: 1000, event: started }]);
  });

  it("空 parentSessionId 事件不落盘（无主事件不汇入垃圾档案）", () => {
    const file = subagentHistoryFile(path.join(dir, "s0.jsonl"), "")!;
    appendSubagentHistoryEvent(file, { childId: "c0", parentSessionId: "", description: "", status: "started" }, 1000);
    expect(existsSync(file)).toBe(false);
  });

  it("删除档案（force）；null 路径无操作", () => {
    const mainFile = path.join(dir, "2026", "09", "04", "s1.jsonl");
    const file = subagentHistoryFile(mainFile, "s1")!;
    appendSubagentHistoryEvent(file, started, 1000);
    expect(existsSync(file)).toBe(true);
    deleteSubagentHistory(file);
    expect(existsSync(file)).toBe(false);
    expect(() => deleteSubagentHistory(null)).not.toThrow();
  });
});
