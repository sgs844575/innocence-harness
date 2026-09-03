// 子代理运行档案的持久化半边（会话外观的存储职责拆分）：lifecycle 事件按
// 会话追加到 transcripts 目录旁的 sidecar（<id>.subagents.jsonl），启动后按
// 会话读回回放建档——面板历史由此跨进程重启存活。流式 delta 不落盘（正文
// 以终态 final/error 为准，工具轨迹与状态才是档案骨架）；读写均防御式，
// 坏行跳过不阻断启动。本模块不依赖 Electron（Node 可测）。
import fs from "node:fs";
import path from "node:path";
import type { SubagentLifecycleEvent } from "../shared/ipc";

/** 一条落盘记录：事件 + 事件时刻（reducer 回放需要真实时间轴）。 */
export interface SubagentHistoryEntry {
  at: number;
  event: SubagentLifecycleEvent;
}

/** <storeDir>/transcripts/<id>.subagents.jsonl；null while the store has no directory. */
export function subagentHistoryFile(storeDir: string | null, id: string): string | null {
  return storeDir ? path.join(storeDir, "transcripts", `${id}.subagents.jsonl`) : null;
}

/** 已确保存在的目录（避免转发热路径上每次 append 都 mkdirSync）。 */
const ensuredDirs = new Set<string>();

/** 追加一条事件（delta 事件不落盘：正文以终态 final/error 呈现；空会话 id
 *  不落盘：无主事件只会汇入永不被读回/清理的垃圾档案）；best-effort。 */
export function appendSubagentHistoryEvent(file: string | null, event: SubagentLifecycleEvent, at: number): void {
  if (!file || event.delta !== undefined || event.parentSessionId === "") return;
  try {
    const dir = path.dirname(file);
    if (!ensuredDirs.has(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      ensuredDirs.add(dir);
    }
    fs.appendFileSync(file, `${JSON.stringify({ at, event })}\n`, "utf8");
  } catch {
    // 档案写失败不阻断事件转发与聊天轮次。
  }
}

/** 读回全部记录（按落盘顺序 = 事件发生顺序）；坏行跳过，缺文件返回空。 */
export function readSubagentHistory(file: string | null): SubagentHistoryEntry[] {
  if (!file) return [];
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return [];
  }
  const entries: SubagentHistoryEntry[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed) as { at?: unknown; event?: unknown };
      if (
        typeof parsed.at === "number" &&
        parsed.event !== null &&
        typeof parsed.event === "object" &&
        typeof (parsed.event as SubagentLifecycleEvent).childId === "string" &&
        typeof (parsed.event as SubagentLifecycleEvent).parentSessionId === "string" &&
        typeof (parsed.event as SubagentLifecycleEvent).status === "string"
      ) {
        entries.push({ at: parsed.at, event: parsed.event as SubagentLifecycleEvent });
      }
    } catch {
      // 坏行（截断/手改）：跳过，后续行仍可回放。
    }
  }
  return entries;
}

/** 会话删除时一并移除档案（与 transcript 同生命周期）；best-effort。 */
export function deleteSubagentHistory(file: string | null): void {
  if (!file) return;
  try {
    fs.rmSync(file, { force: true });
  } catch {
    // 删除失败只留下孤儿档案文件，不影响会话删除。
  }
}
