// 自动归档：候选纯函数 + 巡检服务（设置开关/保留期/存活回合/计时器释放）。
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  selectAutoArchiveCandidates,
  startAutoArchive,
  type AutoArchiveDeps,
  type AutoArchiveSessionLike,
} from "./autoArchive";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse("2026-09-04T00:00:00Z");

const sidebarOf = (entries: Record<string, { archived?: boolean; pinned?: boolean }>) => ({
  archived: Object.fromEntries(Object.entries(entries).map(([id, s]) => [id, s.archived === true])),
  pinned: Object.fromEntries(Object.entries(entries).map(([id, s]) => [id, s.pinned === true])),
});

describe("selectAutoArchiveCandidates", () => {
  const sessions: AutoArchiveSessionLike[] = [
    { id: "old", updatedAt: NOW - 10 * DAY },
    { id: "fresh", updatedAt: NOW - 2 * DAY },
    { id: "archived", updatedAt: NOW - 10 * DAY },
    { id: "pinned", updatedAt: NOW - 10 * DAY },
    { id: "aux", updatedAt: NOW - 10 * DAY, aux: true },
  ];
  const sidebar = sidebarOf({ archived: { archived: true }, pinned: { pinned: true } });

  it("过期且未归档/未置顶/非辅助会话入选", () => {
    expect(selectAutoArchiveCandidates(sessions, sidebar, NOW, 7)).toEqual(["old"]);
  });

  it("保留期边界：updatedAt 恰好等于 cutoff 不入选", () => {
    const atCutoff: AutoArchiveSessionLike[] = [{ id: "edge", updatedAt: NOW - 7 * DAY }];
    expect(selectAutoArchiveCandidates(atCutoff, sidebarOf({}), NOW, 7)).toEqual([]);
    const justPast: AutoArchiveSessionLike[] = [{ id: "edge", updatedAt: NOW - 7 * DAY - 1 }];
    expect(selectAutoArchiveCandidates(justPast, sidebarOf({}), NOW, 7)).toEqual(["edge"]);
  });
});

describe("startAutoArchive", () => {
  function deps(overrides: Partial<AutoArchiveDeps> = {}) {
    const archived: string[] = [];
    const broadcasts = vi.fn();
    const base: AutoArchiveDeps = {
      settings: () => ({ autoArchiveTasks: true, archiveRetentionDays: 7 }),
      listSessions: () => [{ id: "old", updatedAt: NOW - 10 * DAY }],
      sidebarState: () => sidebarOf({}),
      isRunning: () => false,
      archive: (id) => { archived.push(id); },
      broadcast: broadcasts,
      now: () => NOW,
      ...overrides,
    };
    return { base, archived, broadcasts };
  }

  afterEach(() => {
    vi.useRealTimers();
  });

  it("启动后立即巡检一轮：归档过期会话并广播", () => {
    const { base, archived, broadcasts } = deps();
    const service = startAutoArchive({ ...base, intervalMs: 60_000 });
    expect(archived).toEqual(["old"]);
    expect(broadcasts).toHaveBeenCalledTimes(1);
    service.stop();
  });

  it("设置关闭时空转；存活回合的会话不归档", () => {
    const off = deps({ settings: () => ({ autoArchiveTasks: false }) });
    const offService = startAutoArchive({ ...off.base, intervalMs: 60_000 });
    expect(off.archived).toEqual([]);
    expect(off.broadcasts).not.toHaveBeenCalled();
    offService.stop();

    const running = deps({ isRunning: (id) => id === "old" });
    const runningService = startAutoArchive({ ...running.base, intervalMs: 60_000 });
    expect(running.archived).toEqual([]);
    runningService.stop();
  });

  it("每轮读当前设置：开启后下一轮生效（假时钟）", () => {
    vi.useFakeTimers();
    let enabled = false;
    const { base, archived, broadcasts } = deps({
      settings: () => ({ autoArchiveTasks: enabled, archiveRetentionDays: 7 }),
    });
    const service = startAutoArchive({ ...base, intervalMs: 1_000 });
    expect(archived).toEqual([]);

    enabled = true;
    vi.advanceTimersByTime(1_000);
    expect(archived).toEqual(["old"]);
    expect(broadcasts).toHaveBeenCalledTimes(1);

    // stop 后不再巡检。
    service.stop();
    vi.advanceTimersByTime(10_000);
    expect(broadcasts).toHaveBeenCalledTimes(1);
  });

  it("单条归档失败不阻断整轮；runOnce 返回实际归档集", () => {
    const { base, archived, broadcasts } = deps({
      listSessions: () => [
        { id: "bad", updatedAt: NOW - 10 * DAY },
        { id: "good", updatedAt: NOW - 10 * DAY },
      ],
      archive: (id) => {
        if (id === "bad") throw new Error("persist failed");
        archived.push(id);
      },
    });
    const service = startAutoArchive({ ...base, intervalMs: 60_000 });
    expect(service.runOnce()).toEqual(["good"]);
    expect(broadcasts).toHaveBeenCalled();
    service.stop();
  });

  it("archiveRetentionDays 非法值回落 7 天", () => {
    const { base, archived } = deps({
      settings: () => ({ autoArchiveTasks: true, archiveRetentionDays: 0 }),
      listSessions: () => [{ id: "old", updatedAt: NOW - 10 * DAY }],
    });
    const service = startAutoArchive({ ...base, intervalMs: 60_000 });
    expect(archived).toEqual(["old"]);
    service.stop();
  });
});
