// LSP stdio 客户端（语言服务器波）：spawn 一个语言服务器子进程，走
// Content-Length 分帧的 JSON-RPC。进程生命周期纪律沿用本仓 MCP stdio
// 客户端的既定形态——windowsHide + shell:false 杀树（win32 taskkill /T）、
// 请求超时 + 挂起表、优雅 dispose（shutdown → exit → 宽限 → 杀树）且
// 幂等；服务器主动通知（publishDiagnostics 等）分发到 onNotification，
// 服务器发起的请求（window/showMessage 等）一律以 methodNotFound 拒绝
// （本客户端不实现任何服务器→客户端能力）。
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { encodeLspMessage, LspFrameDecoder, type LspMessage } from "./protocol";

export interface LspServerOptions {
  /** 可执行文件（真实可执行名；无 shell 参与，Windows 下 .cmd 不可用）。 */
  command: string;
  args?: string[];
  env?: Record<string, string>;
  /** 服务器工作目录；缺省 = 服务的 workspace root。 */
  cwd?: string;
  initializationOptions?: unknown;
  settings?: unknown;
}

export interface LspClientEvents {
  /** 服务器通知（publishDiagnostics、logMessage、…）。 */
  onNotification?: (method: string, params: unknown) => void;
  /** 服务器进程退出（崩溃或正常 shutdown 后）。 */
  onExit?: (code: number | null) => void;
  /** 传输层损坏（分帧/JSON 错误）：连接此后不可用。 */
  onTransportError?: (error: Error) => void;
}

const REQUEST_TIMEOUT_MS = 30_000;
const DISPOSE_GRACE_MS = 2_000;
const EXIT_WAIT_MS = 5_000;

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

/** 供测试注入的 spawn 面。 */
export type SpawnFn = (command: string, args: readonly string[], options: {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  stdio: ["pipe", "pipe", "pipe"];
  windowsHide: boolean;
  shell: false;
}) => ChildProcess;

function killTree(child: ChildProcess): void {
  if (typeof child.pid === "number" && process.platform === "win32") {
    spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
    });
  } else {
    child.kill("SIGKILL");
  }
}

export class LspClient {
  private child: ChildProcess | undefined;
  private readonly decoder = new LspFrameDecoder();
  private readonly pending = new Map<number, PendingRequest>();
  private nextId = 1;
  private exited = false;
  private exitError: Error | undefined;
  private disposal: Promise<void> | undefined;

  constructor(
    private readonly options: LspServerOptions,
    private readonly events: LspClientEvents = {},
    private readonly spawnFn: SpawnFn = (command, args, opts) =>
      spawn(command, args as string[], opts),
  ) {}

  get isExited(): boolean {
    return this.exited;
  }

  /** 服务器声明的能力（initialize 响应 result；start 后可读）。 */
  get serverCapabilities(): unknown {
    return this.capabilities;
  }

  private capabilities: unknown;

  async start(input: { processId?: number; workspaceRoot: string }): Promise<void> {
    if (this.exited) throw new Error("LSP client is closed.");
    const child = this.spawnFn(this.options.command, this.options.args ?? [], {
      ...(this.options.cwd !== undefined || input.workspaceRoot !== ""
        ? { cwd: this.options.cwd ?? input.workspaceRoot }
        : {}),
      env: { ...process.env, ...(this.options.env ?? {}) },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      shell: false,
    });
    this.child = child;
    child.stdout?.on("data", (chunk: Buffer) => {
      let messages: LspMessage[];
      try {
        messages = this.decoder.feed(chunk);
      } catch (error) {
        this.failTransport(error instanceof Error ? error : new Error(String(error)));
        return;
      }
      for (const message of messages) this.dispatch(message);
    });
    child.stderr?.on("data", () => {/* 服务器诊断输出：忽略（宿主日志可后接） */});
    child.once("error", (error) => this.settleExit(new Error(`LSP server failed to start: ${error.message}`)));
    child.once("exit", (code) => this.settleExit(code === null ? undefined : new Error(`LSP server exited with code ${code}`), code));
    if (child.stdin === null || child.stdout === null) {
      throw new Error("LSP server stdio is not piped.");
    }
    const result = await this.request<{ capabilities?: unknown }>("initialize", {
      initializationOptions: this.options.initializationOptions,
      processId: input.processId ?? process.pid,
      rootUri: pathToFileUriSafe(input.workspaceRoot),
      capabilities: {
        textDocument: { synchronization: { dynamicRegistration: false, didSave: false } },
      },
      workspace: { workspaceFolders: false },
    });
    this.capabilities = result?.capabilities;
    this.notify("initialized", {});
    if (this.options.settings !== undefined) this.notify("workspace/didChangeConfiguration", { settings: this.options.settings });
  }

  private dispatch(message: LspMessage): void {
    if (this.exited) return;
    if (message.method !== undefined && message.id !== undefined) {
      // 服务器发起的请求：本客户端不实现服务器面能力，规范拒绝。
      this.write({
        jsonrpc: "2.0",
        id: message.id,
        error: { code: -32601, message: `client does not implement "${message.method}"` },
      });
      return;
    }
    if (message.method !== undefined) {
      this.events.onNotification?.(message.method, message.params);
      return;
    }
    if (message.id !== undefined) {
      const pending = this.pending.get(Number(message.id));
      if (pending === undefined) return;
      this.pending.delete(Number(message.id));
      clearTimeout(pending.timer);
      if (message.error !== undefined) {
        pending.reject(new Error(`LSP request failed (${message.error.code}): ${message.error.message}`));
      } else {
        pending.resolve(message.result);
      }
    }
  }

  private write(message: LspMessage): void {
    if (this.exited || this.child?.stdin === null) throw new Error("LSP client is closed.");
    this.child?.stdin?.write(encodeLspMessage(message));
  }

  private failTransport(error: Error): void {
    this.events.onTransportError?.(error);
    this.settleExit(error);
    if (this.child !== undefined && this.child.exitCode === null) killTree(this.child);
  }

  private settleExit(error: Error | undefined, code: number | null = null): void {
    if (this.exited) return;
    this.exited = true;
    this.exitError = error;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(this.exitError ?? new Error("LSP server exited."));
    }
    this.pending.clear();
    this.events.onExit?.(code);
  }

  request<T = unknown>(method: string, params?: unknown): Promise<T> {
    if (this.exited) return Promise.reject(this.exitError ?? new Error("LSP client is closed."));
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`LSP request "${method}" timed out.`));
      }, REQUEST_TIMEOUT_MS);
      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
        timer,
      });
      try {
        this.write({ jsonrpc: "2.0", id, method, ...(params !== undefined ? { params } : {}) });
      } catch (error) {
        this.pending.delete(id);
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  notify(method: string, params?: unknown): void {
    this.write({ jsonrpc: "2.0", method, ...(params !== undefined ? { params } : {}) });
  }

  /** didOpen 通知：textDocument/didOpen {uri, languageId, version, text}。 */
  didOpen(uri: string, languageId: string, text: string): void {
    this.notify("textDocument/didOpen", {
      textDocument: { uri, languageId, version: 1, text },
    });
  }

  didClose(uri: string): void {
    this.notify("textDocument/didClose", { textDocument: { uri } });
  }

  /** 停止：shutdown 请求（尽力）→ exit 通知 → 宽限后杀树；幂等。 */
  dispose(): Promise<void> {
    this.disposal ??= (async () => {
      if (!this.exited) {
        try {
          await this.request("shutdown");
        } catch {
          /* 尽力而为：超时/已退出都直接走 exit */
        }
        try {
          this.notify("exit");
        } catch {
          /* stdin 可能已关 */
        }
        await new Promise<void>((resolve) => {
          const timer = setTimeout(() => {
            if (this.child !== undefined && this.child.exitCode === null) killTree(this.child);
            setTimeout(resolve, DISPOSE_GRACE_MS);
          }, EXIT_WAIT_MS);
          this.child?.once("exit", () => {
            clearTimeout(timer);
            resolve();
          });
          if (this.exited) {
            clearTimeout(timer);
            resolve();
          }
        });
      }
      if (this.child !== undefined && this.child.exitCode === null) killTree(this.child);
    })();
    return this.disposal;
  }
}

function pathToFileUriSafe(value: string): string {
  if (value === "") return "";
  try {
    return pathToFileURL(path.resolve(value)).toString();
  } catch {
    return "";
  }
}
