// Terminal IPC channels and DTOs — the renderer-facing contract for the
// route-bound terminal (Task 9). Mirrors taskIpc.ts conventions:
//   - Renderer requests carry ONLY taskId/routeId/ptyId (+ input text or
//     cols/rows) — never absolute paths. The main process resolves the cwd
//     from the task runtime bridge's route handle.
//   - Main -> renderer output/exit events carry the full identity triple.

// ---------------------------------------------------------------------------
// Channel names
// ---------------------------------------------------------------------------

export const TerminalIpcChannels = {
  terminalCreate: "terminal:create",
  terminalWrite: "terminal:write",
  terminalResize: "terminal:resize",
  terminalDispose: "terminal:dispose",
  /** Main -> renderer: shell output bytes. */
  terminalOutput: "terminal:output",
  /** Main -> renderer: the shell process tree exited. */
  terminalExit: "terminal:exit",
  /** Main -> renderer: shell transcript events from tool execution. */
  terminalShell: "terminal:shell",
  /** dock 终端（非任务路由，cwd 由渲染端的项目根给出）：创建/写/调尺寸/释放。 */
  dockTerminalCreate: "terminal:dock-create",
  dockTerminalWrite: "terminal:dock-write",
  dockTerminalResize: "terminal:dock-resize",
  dockTerminalDispose: "terminal:dock-dispose",
  /** Main -> renderer: dock 终端输出与退出。 */
  dockTerminalOutput: "terminal:dock-output",
  dockTerminalExit: "terminal:dock-exit",
} as const;

// ---------------------------------------------------------------------------
// Request / Response DTOs per channel
// ---------------------------------------------------------------------------

export interface TerminalCreateRequest {
  taskId: string;
  routeId: string;
  /** Initial grid size (xterm dimensions); omitted -> 80x24. */
  cols?: number;
  rows?: number;
}

export interface TerminalCreateResponse {
  taskId: string;
  routeId: string;
  ptyId: string;
}

export interface TerminalWriteRequest {
  taskId: string;
  routeId: string;
  ptyId: string;
  /** Keystrokes to feed the shell. */
  data: string;
}

export interface TerminalResizeRequest {
  taskId: string;
  routeId: string;
  ptyId: string;
  cols: number;
  rows: number;
}

export interface TerminalDisposeRequest {
  taskId: string;
  routeId: string;
  ptyId: string;
}

// ---------------------------------------------------------------------------
// Main -> renderer events
// ---------------------------------------------------------------------------

export interface TerminalOutputEvent {
  taskId: string;
  routeId: string;
  ptyId: string;
  data: string;
}

export interface TerminalExitEvent {
  taskId: string;
  routeId: string;
  ptyId: string;
  exitCode: number | null;
}

/** A shell-tool transcript has no PTY identity unless one already exists. */
export type ShellTranscriptEvent =
  | {
      type: "started";
      sessionId: string;
      taskId: string;
      routeId: string;
      invocationId: string;
      command: string;
      ptyId?: string;
    }
  | {
      type: "output";
      sessionId: string;
      taskId: string;
      routeId: string;
      invocationId: string;
      data: string;
      stream: "stdout" | "stderr";
      ptyId?: string;
    }
  | {
      type: "completed";
      sessionId: string;
      taskId: string;
      routeId: string;
      invocationId: string;
      exitCode: number | null;
      timedOut: boolean;
      error?: string;
      ptyId?: string;
    };

// ---------------------------------------------------------------------------
// Dock terminal DTOs (右侧 dock 的独立终端：非任务路由，cwd = 渲染端项目根)
// ---------------------------------------------------------------------------

export interface DockTerminalCreateRequest {
  /** dock 标签实例 id（一标签一终端）。 */
  terminalId: string;
  /** 工作目录（渲染端项目根；空串 → 主进程回退用户主目录）。 */
  cwd: string;
  cols?: number;
  rows?: number;
}

export interface DockTerminalCreateResponse {
  terminalId: string;
  ptyId: string;
}

export interface DockTerminalWriteRequest {
  terminalId: string;
  ptyId: string;
  data: string;
}

export interface DockTerminalResizeRequest {
  terminalId: string;
  ptyId: string;
  cols: number;
  rows: number;
}

export interface DockTerminalDisposeRequest {
  terminalId: string;
  /** 缺省 = 按 terminalId 直接释放（标签关闭路径）；带值时必须匹配存活会话。 */
  ptyId?: string;
}

export interface DockTerminalOutputEvent {
  terminalId: string;
  ptyId: string;
  data: string;
}

export interface DockTerminalExitEvent {
  terminalId: string;
  ptyId: string;
  exitCode: number | null;
}

// ---------------------------------------------------------------------------
// Renderer-callable API surface (typed; the preload bridge implements it)
// ---------------------------------------------------------------------------

export interface TerminalIpcApi {
  create(request: TerminalCreateRequest): Promise<TerminalCreateResponse>;
  write(request: TerminalWriteRequest): Promise<void>;
  resize(request: TerminalResizeRequest): Promise<void>;
  dispose(request: TerminalDisposeRequest): Promise<void>;
  onTerminalOutput(cb: (e: TerminalOutputEvent) => void): () => void;
  onTerminalExit(cb: (e: TerminalExitEvent) => void): () => void;
  onShellTranscript(cb: (e: ShellTranscriptEvent) => void): () => void;
  /** dock 终端（右侧 dock 标签的独立 PTY）。 */
  dockCreate(request: DockTerminalCreateRequest): Promise<DockTerminalCreateResponse>;
  dockWrite(request: DockTerminalWriteRequest): Promise<void>;
  dockResize(request: DockTerminalResizeRequest): Promise<void>;
  dockDispose(request: DockTerminalDisposeRequest): Promise<void>;
  onDockTerminalOutput(cb: (e: DockTerminalOutputEvent) => void): () => void;
  onDockTerminalExit(cb: (e: DockTerminalExitEvent) => void): () => void;
}
