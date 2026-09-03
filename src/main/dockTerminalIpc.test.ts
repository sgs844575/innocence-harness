// DockTerminalIpcService 测试：DTO 校验、cwd 解析（存在目录/回退主目录/拒绝缺失）、
// 事件按 terminalId 转发、ptyId 防呆。用 fake PtyManager（真实 node-pty 管理器由
// packages/terminal-pty/tests 覆盖）。
import os from "node:os";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import type { PtyEvent, PtyExitEvent, PtyManager, PtySession } from "@innocenceharness/terminal-pty";
import { TerminalIpcChannels } from "../shared/terminalIpc";
import { createDockTerminalIpcService } from "./dockTerminalIpc";

class FakeSession implements PtySession {
  readonly writes: string[] = [];
  readonly resizes: Array<{ cols: number; rows: number }> = [];
  disposed = false;
  constructor(
    readonly ptyId: string,
    readonly taskId: string,
    readonly routeId: string,
    readonly cwd: string,
  ) {}
  write(data: string): void {
    this.writes.push(data);
  }
  resize(cols: number, rows: number): void {
    this.resizes.push({ cols, rows });
  }
  output: () => Promise<string> = async () => "";
  onExit(_listener: (event: PtyExitEvent) => void): () => void {
    return () => {};
  }
  dispose: () => Promise<void> = async () => {
    this.disposed = true;
  };
}

class FakeManager implements PtyManager {
  readonly sessions = new Map<string, FakeSession>();
  private seq = 0;
  constructor(private eventSink?: (event: PtyEvent) => void) {}
  emit(event: PtyEvent): void {
    this.eventSink?.(event);
  }
  create = async (input: { taskId: string; routeId: string; cwd: string; cols?: number; rows?: number }) => {
    const session = new FakeSession(`pty_fake_${++this.seq}`, input.taskId, input.routeId, input.cwd);
    this.sessions.set(`${input.taskId}::${input.routeId}`, session);
    return session;
  };
  get = (taskId: string, routeId: string) => this.sessions.get(`${taskId}::${routeId}`);
  disposeForRoute = async (taskId: string, routeId: string) => {
    const session = this.sessions.get(`${taskId}::${routeId}`);
    if (session) {
      session.disposed = true;
      this.sessions.delete(`${taskId}::${routeId}`);
    }
  };
  disposeAll = async () => {
    for (const [key, session] of this.sessions) {
      session.disposed = true;
      this.sessions.delete(key);
    }
  };
}

let manager: FakeManager;
let send: Mock<(channel: string, payload: unknown) => void>;
let service: ReturnType<typeof createDockTerminalIpcService>;
const cwd = os.tmpdir();

beforeEach(() => {
  send = vi.fn();
  service = createDockTerminalIpcService({
    send,
    createManager: (onEvent) => {
      manager = new FakeManager(onEvent);
      return manager;
    },
  });
});

describe("dock terminal create", () => {
  it("creates a pty keyed by terminalId with the validated cwd", async () => {
    const created = await service.create({ terminalId: "term_1", cwd, cols: 100, rows: 30 });
    expect(created.ptyId).toBe("pty_fake_1");
    expect(manager.create.length).toBeGreaterThan(-1);
    expect(manager.get("dock", "term_1")?.cwd).toBe(cwd);
  });

  it("空 cwd 回退用户主目录；缺失目录与非法 id 拒绝", async () => {
    const home = await service.create({ terminalId: "term_2", cwd: "" });
    expect(manager.get("dock", "term_2")?.cwd).toBe(os.homedir());
    expect(home.terminalId).toBe("term_2");
    await expect(service.create({ terminalId: "term_3", cwd: "D:/no-such-dir-xyz" })).rejects.toThrow("does not exist");
    await expect(service.create({ terminalId: "../evil", cwd })).rejects.toThrow("unsafe terminalId");
  });

  it("非法尺寸拒绝", async () => {
    await expect(service.create({ terminalId: "term_4", cwd, cols: 1 })).rejects.toThrow("invalid cols");
  });
});

describe("dock terminal io", () => {
  it("write/resize 走存活会话；ptyId 不匹配拒绝", async () => {
    const created = await service.create({ terminalId: "term_1", cwd });
    await service.write({ terminalId: "term_1", ptyId: created.ptyId, data: "ls\r" });
    expect(manager.get("dock", "term_1")?.writes).toEqual(["ls\r"]);
    await service.resize({ terminalId: "term_1", ptyId: created.ptyId, cols: 120, rows: 40 });
    expect(manager.get("dock", "term_1")?.resizes).toEqual([{ cols: 120, rows: 40 }]);
    await expect(service.write({ terminalId: "term_1", ptyId: "pty_stale", data: "x" })).rejects.toThrow("no live pty");
  });

  it("dispose：标签关闭路径（无 ptyId）直接释放；带陈旧 ptyId 拒绝误杀", async () => {
    const created = await service.create({ terminalId: "term_1", cwd });
    await expect(service.dispose({ terminalId: "term_1", ptyId: "pty_stale" })).rejects.toThrow("no live pty");
    await service.dispose({ terminalId: "term_1" });
    expect(manager.get("dock", "term_1")).toBeUndefined();
    void created;
  });
});

describe("dock terminal events", () => {
  it("pty 输出/退出事件按 terminalId 推送渲染端", async () => {
    await service.create({ terminalId: "term_1", cwd });
    manager.emit({ type: "output", taskId: "dock", routeId: "term_1", ptyId: "pty_fake_1", data: "hello" });
    manager.emit({ type: "exit", taskId: "dock", routeId: "term_1", ptyId: "pty_fake_1", exitCode: 0 });
    expect(send).toHaveBeenCalledWith(TerminalIpcChannels.dockTerminalOutput, {
      terminalId: "term_1",
      ptyId: "pty_fake_1",
      data: "hello",
    });
    expect(send).toHaveBeenCalledWith(TerminalIpcChannels.dockTerminalExit, {
      terminalId: "term_1",
      ptyId: "pty_fake_1",
      exitCode: 0,
    });
  });
});
