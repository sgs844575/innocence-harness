import { WebSocket } from "ws";

export interface WsServerOptions {
  /** WebSocket endpoint (ws:// or wss://). */
  url: string;
  /** Extra handshake headers (e.g. auth tokens). */
  headers?: Record<string, string>;
  /** Connection open timeout; default 15 seconds. */
  connectTimeoutMs?: number;
}

/** Per-request options; shared semantics with the stdio client. */
export interface WsRequestOptions {
  signal?: AbortSignal;
}

interface Pending {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
  detach: () => void;
}

const REQUEST_TIMEOUT_MS = 60_000;
const DEFAULT_CONNECT_TIMEOUT_MS = 15_000;

/** Server-provided error text is untrusted; strip control chars and truncate. */
function sanitizeServerMessage(raw: string | undefined): string {
  const text = (raw ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim();
  return text.length === 0 ? "MCP 错误" : text.length <= 500 ? text : `${text.slice(0, 500)}…[已截断]`;
}

function requestAbortedError(method: string): Error {
  const err = new Error(`MCP 请求已中止：${method}`);
  err.name = "AbortError";
  return err;
}

/**
 * Minimal JSON-RPC 2.0 client over WebSocket (one JSON message per frame).
 * Mirrors the stdio client's semantics: one response per request id, fire-and
 * forget notifications, bounded request timeout, abort rides to the server as
 * `notifications/cancelled`, and idempotent dispose closing the socket.
 */
export class WsJsonRpcClient {
  private socket: WebSocket | undefined;
  private nextId = 0;
  private pending = new Map<number, Pending>();
  private exited = false;
  private disposed = false;
  private disposePromise: Promise<void> | undefined;
  onExit: (() => void) | undefined;

  constructor(private readonly options: WsServerOptions) {}

  get isExited(): boolean {
    return this.exited;
  }

  /** Opens the socket; rejects on error or when the open timeout elapses. */
  async start(): Promise<void> {
    const socket = new WebSocket(this.options.url, {
      ...(this.options.headers ? { headers: this.options.headers } : {}),
      handshakeTimeout: this.options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS,
    });
    this.socket = socket;
    await new Promise<void>((resolve, reject) => {
      const onOpen = () => {
        detach();
        resolve();
      };
      const onError = (error: Error) => {
        detach();
        reject(error);
      };
      const detach = () => {
        socket.off("open", onOpen);
        socket.off("error", onError);
      };
      socket.on("open", onOpen);
      socket.on("error", onError);
    });
    socket.on("message", (data: unknown) => this.onMessage(data));
    socket.on("error", () => this.failAll(new Error("MCP 服务器连接错误")));
    socket.on("close", () => {
      this.exited = true;
      this.failAll(new Error("MCP 服务器连接已关闭"));
      this.onExit?.();
    });
  }

  request<T>(method: string, params?: unknown, options?: WsRequestOptions): Promise<T> {
    const id = ++this.nextId;
    const signal = options?.signal;
    return new Promise<T>((resolve, reject) => {
      if (this.disposed || this.exited || !this.socket) {
        reject(new Error(this.disposed ? "MCP 客户端已释放" : "MCP 服务器不可用"));
        return;
      }
      if (signal?.aborted) {
        reject(requestAbortedError(method));
        return;
      }
      const onAbort = () => {
        this.pending.delete(id);
        clearTimeout(timer);
        this.send({
          jsonrpc: "2.0",
          method: "notifications/cancelled",
          params: { requestId: id, reason: "client aborted" },
        });
        reject(requestAbortedError(method));
      };
      const detach = () => signal?.removeEventListener("abort", onAbort);
      const timer = setTimeout(() => {
        this.pending.delete(id);
        detach();
        reject(new Error(`MCP 请求超时：${method}`));
      }, REQUEST_TIMEOUT_MS);
      signal?.addEventListener("abort", onAbort, { once: true });
      this.pending.set(id, {
        resolve: resolve as (v: unknown) => void,
        reject,
        timer,
        detach,
      });
      this.send({ jsonrpc: "2.0", id, method, params });
    });
  }

  notify(method: string, params?: unknown): void {
    this.send({ jsonrpc: "2.0", method, params });
  }

  /** Idempotent teardown: closes the socket and fails pending requests. */
  dispose(): Promise<void> {
    this.disposed = true;
    this.disposePromise ??= this.doDispose();
    return this.disposePromise;
  }

  private async doDispose(): Promise<void> {
    const socket = this.socket;
    if (socket && !this.exited) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 2_000);
        socket.once("close", () => {
          clearTimeout(timer);
          resolve();
        });
        try {
          socket.close(1000, "client dispose");
        } catch {
          clearTimeout(timer);
          resolve();
        }
      });
    }
    this.failAll(new Error("MCP 客户端已释放"));
  }

  /** Synchronous last-resort teardown for activation-rollback paths. */
  stop(): void {
    try {
      this.socket?.terminate();
    } catch {
      // already gone
    }
    this.failAll(new Error("MCP 客户端已停止"));
  }

  private send(msg: unknown): void {
    const socket = this.socket;
    if (!socket || socket.readyState !== 1) return;
    try {
      socket.send(JSON.stringify(msg));
    } catch {
      // send-after-close races surface via the close path
    }
  }

  private onMessage(data: unknown): void {
    if (Array.isArray(data)) return; // binary frames carry no JSON-RPC traffic
    const text = typeof data === "string" ? data : Buffer.from(data as ArrayBuffer).toString("utf8");
    let msg: { id?: number; result?: unknown; error?: { message?: string } };
    try {
      msg = JSON.parse(text);
    } catch {
      return; // tolerate non-JSON frames
    }
    if (typeof msg.id !== "number") return; // notifications from server
    const pending = this.pending.get(msg.id);
    if (!pending) return;
    this.pending.delete(msg.id);
    pending.detach();
    clearTimeout(pending.timer);
    if (msg.error) pending.reject(new Error(sanitizeServerMessage(msg.error.message)));
    else pending.resolve(msg.result);
  }

  private failAll(err: Error): void {
    for (const [, p] of this.pending) {
      p.detach();
      clearTimeout(p.timer);
      p.reject(err);
    }
    this.pending.clear();
  }
}
