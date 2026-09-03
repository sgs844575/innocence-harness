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
  it("档案路径位于 transcripts 目录（<id>.subagents.jsonl）；null store 无路径", () => {
    expect(subagentHistoryFile(dir, "s1")).toBe(path.join(dir, "transcripts", "s1.subagents.jsonl"));
    expect(subagentHistoryFile(null, "s1")).toBeNull();
  });

  it("追加事件按序落盘并可读回；delta 事件不落盘", () => {
    const file = subagentHistoryFile(dir, "s1")!;
    appendSubagentHistoryEvent(file, started, 1000);
    appendSubagentHistoryEvent(file, { childId: "c1", parentSessionId: "s1", description: "", status: "running", delta: "流式增量" }, 1100);
    appendSubagentHistoryEvent(file, { childId: "c1", parentSessionId: "s1", description: "", status: "completed", final: "报告" }, 5000);
    const entries = readSubagentHistory(file);
    expect(entries).toHaveLength(2);
    expect(entries[0]).toEqual({ at: 1000, event: started });
    expect(entries[1]).toEqual({ at: 5000, event: { childId: "c1", parentSessionId: "s1", description: "", status: "completed", final: "报告" } });
  });

  it("缺文件返回空；坏行/不完整行跳过，好行仍可回放", () => {
    expect(readSubagentHistory(subagentHistoryFile(dir, "none"))).toEqual([]);
    const file = subagentHistoryFile(dir, "s1")!;
    appendSubagentHistoryEvent(file, started, 1000);
    writeFileSync(file, "{ 截断行\n{\"at\":\"x\"}\n" + readFileSync(file, "utf8"), "utf8");
    const entries = readSubagentHistory(file);
    expect(entries).toEqual([{ at: 1000, event: started }]);
  });

  it("空 parentSessionId 事件不落盘（无主事件不汇入垃圾档案）", () => {
    const file = subagentHistoryFile(dir, "")!;
    appendSubagentHistoryEvent(file, { childId: "c0", parentSessionId: "", description: "", status: "started" }, 1000);
    expect(existsSync(file)).toBe(false);
  });

  it("删除档案（force）；null 路径无操作", () => {
    const file = subagentHistoryFile(dir, "s1")!;
    appendSubagentHistoryEvent(file, started, 1000);
    expect(existsSync(file)).toBe(true);
    deleteSubagentHistory(file);
    expect(existsSync(file)).toBe(false);
    expect(() => deleteSubagentHistory(null)).not.toThrow();
  });
});
