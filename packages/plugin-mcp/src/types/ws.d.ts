// 本仓库用到的 WebSocket 客户端/服务端面（该包未自带类型声明；按实际
// 使用的 API 声明，事件监听统一为回调注册形态）。
declare module "ws" {
  export class WebSocket {
    static readonly CONNECTING: 0;
    static readonly OPEN: 1;
    static readonly CLOSING: 2;
    static readonly CLOSED: 3;

    readonly readyState: 0 | 1 | 2 | 3;
    constructor(url: string, options?: { headers?: Record<string, string>; handshakeTimeout?: number });
    on(event: "open", listener: () => void): this;
    on(event: "message", listener: (data: unknown, isBinary: boolean) => void): this;
    on(event: "error", listener: (error: Error) => void): this;
    on(event: "close", listener: (code: number, reason: Buffer) => void): this;
    once(event: "open", listener: () => void): this;
    once(event: "error", listener: (error: Error) => void): this;
    once(event: "close", listener: (code: number, reason: Buffer) => void): this;
    off(event: "open", listener: () => void): this;
    off(event: "error", listener: (error: Error) => void): this;
    off(event: "close", listener: (code: number, reason: Buffer) => void): this;
    send(data: string): void;
    close(code?: number, reason?: string): void;
    terminate(): void;
  }

  export interface WebSocketServerOptions {
    port?: number;
    host?: string;
    server?: unknown;
  }

  export class WebSocketServer {
    constructor(options?: WebSocketServerOptions, callback?: () => void);
    readonly options: WebSocketServerOptions & { port?: number };
    on(event: "connection", listener: (socket: WebSocket, request: unknown) => void): this;
    on(event: "listening", listener: () => void): this;
    address(): { port: number } | { address: string; port: number; family: string };
    close(callback?: (error?: Error) => void): void;
  }
}
