// Dock terminal IPC — 右侧 dock 标签的独立终端（非任务路由）。与 terminalIpc.ts
// 同构但更简单：cwd 来自渲染端的项目根（校验为存在的目录，空串回退用户主目录），
// 事件按 terminalId 推送。Electron 接触点仅 registerDockTerminalIpc（惰性导入，
// 模块本体保持 Node 可加载以跑 vitest）。
import fs from "node:fs";
import os from "node:os";
import { createPtyManager, type PtyEvent, type PtyManager } from "@innocenceharness/terminal-pty";
import {
  TerminalIpcChannels,
  type DockTerminalCreateRequest,
  type DockTerminalCreateResponse,
  type DockTerminalDisposeRequest,
  type DockTerminalResizeRequest,
  type DockTerminalWriteRequest,
} from "../shared/terminalIpc";

/** dock 终端在 PtyManager 里的固定 taskId（routeId = terminalId）。 */
const DOCK_TASK_ID = "dock";

// 与 terminalIpc 同一 id 纪律：单段安全标识。
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

function assertTerminalId(value: unknown): string {
  if (typeof value !== "string" || !ID_PATTERN.test(value)) {
    throw new Error(`dock terminal ipc: unsafe terminalId: ${JSON.stringify(value)}`);
  }
  return value;
}

function assertDimension(value: unknown, field: "cols" | "rows"): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 2 || value > 500) {
    throw new Error(`dock terminal ipc: invalid ${field}: ${JSON.stringify(value)}`);
  }
  return value;
}

/** cwd 校验：存在的目录；空串 → 用户主目录。 */
function resolveCwd(value: unknown): string {
  if (typeof value !== "string") throw new Error("dock terminal ipc: cwd must be a string");
  const trimmed = value.trim();
  if (trimmed === "") return os.homedir();
  let stat: fs.Stats;
  try {
    stat = fs.statSync(trimmed);
  } catch {
    throw new Error(`dock terminal ipc: cwd does not exist: ${trimmed}`);
  }
  if (!stat.isDirectory()) throw new Error(`dock terminal ipc: cwd is not a directory: ${trimmed}`);
  return trimmed;
}

export interface DockTerminalIpcService {
  create(request: DockTerminalCreateRequest): Promise<DockTerminalCreateResponse>;
  write(request: DockTerminalWriteRequest): Promise<void>;
  resize(request: DockTerminalResizeRequest): Promise<void>;
  dispose(request: DockTerminalDisposeRequest): Promise<void>;
  /** App quit path: kills every dock shell tree. Never rejects. */
  disposeAll(): Promise<void>;
}

export interface DockTerminalIpcDeps {
  /** Renderer push port (webContents.send wrapper for the main window). */
  send(channel: string, payload: unknown): void;
  /** Manager factory override (tests); defaults to the real node-pty manager. */
  createManager?: (onEvent: (event: PtyEvent) => void) => PtyManager;
}

export function createDockTerminalIpcService(deps: DockTerminalIpcDeps): DockTerminalIpcService {
  const forward = (event: PtyEvent): void => {
    if (event.type === "output") {
      deps.send(TerminalIpcChannels.dockTerminalOutput, {
        terminalId: event.routeId,
        ptyId: event.ptyId,
        data: event.data,
      });
    } else {
      deps.send(TerminalIpcChannels.dockTerminalExit, {
        terminalId: event.routeId,
        ptyId: event.ptyId,
        exitCode: event.exitCode,
      });
    }
  };

  const manager: PtyManager = deps.createManager?.(forward) ?? createPtyManager({ onEvent: forward });

  /** Resolves the live session; write/resize 必须有匹配 ptyId（陈旧渲染端不许动新终端）。 */
  function liveSession(terminalId: string, ptyId: unknown) {
    if (typeof ptyId !== "string" || ptyId === "") {
      throw new Error(`dock terminal ipc: missing ptyId for ${terminalId}`);
    }
    const session = manager.get(DOCK_TASK_ID, terminalId);
    if (!session || session.ptyId !== ptyId) {
      throw new Error(`dock terminal ipc: no live pty ${ptyId} for terminal ${terminalId}`);
    }
    return session;
  }

  return {
    async create(request) {
      const terminalId = assertTerminalId(request?.terminalId);
      const cwd = resolveCwd(request?.cwd);
      const cols = request?.cols === undefined ? 80 : assertDimension(request.cols, "cols");
      const rows = request?.rows === undefined ? 24 : assertDimension(request.rows, "rows");
      const session = await manager.create({ taskId: DOCK_TASK_ID, routeId: terminalId, cwd, cols, rows });
      return { terminalId, ptyId: session.ptyId };
    },

    async write(request) {
      const terminalId = assertTerminalId(request?.terminalId);
      if (typeof request?.data !== "string") {
        throw new Error("dock terminal ipc: write requires string data");
      }
      liveSession(terminalId, request.ptyId).write(request.data);
    },

    async resize(request) {
      const terminalId = assertTerminalId(request?.terminalId);
      const cols = assertDimension(request?.cols, "cols");
      const rows = assertDimension(request?.rows, "rows");
      liveSession(terminalId, request.ptyId).resize(cols, rows);
    },

    async dispose(request) {
      const terminalId = assertTerminalId(request?.terminalId);
      if (request?.ptyId !== undefined) liveSession(terminalId, request.ptyId);
      await manager.disposeForRoute(DOCK_TASK_ID, terminalId);
    },

    async disposeAll() {
      await manager.disposeAll().catch(() => undefined);
    },
  };
}

/** Registers the ipcMain handlers（动态导入 electron，保持模块 Node 可加载）。 */
export async function registerDockTerminalIpc(service: DockTerminalIpcService): Promise<void> {
  const { ipcMain } = await import("electron");
  ipcMain.handle(TerminalIpcChannels.dockTerminalCreate, (_e, req) => service.create(req));
  ipcMain.handle(TerminalIpcChannels.dockTerminalWrite, (_e, req) => service.write(req));
  ipcMain.handle(TerminalIpcChannels.dockTerminalResize, (_e, req) => service.resize(req));
  ipcMain.handle(TerminalIpcChannels.dockTerminalDispose, (_e, req) => service.dispose(req));
}
