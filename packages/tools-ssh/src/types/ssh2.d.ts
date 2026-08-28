// 本仓库用到的 ssh2 客户端面（该包未自带类型声明；按实际使用的 API 声明）。
declare module "ssh2" {
  export interface ConnectConfig {
    host: string;
    port?: number;
    username: string;
    password?: string;
    privateKey?: string | Buffer;
    passphrase?: string;
    tryKeyboard?: boolean;
    readyTimeout?: number;
  }

  export interface ExecStream {
    on(event: "data", listener: (chunk: Buffer) => void): this;
    on(event: "close", listener: (code: number | null, signal?: string | null) => void): this;
    stderr: { on(event: "data", listener: (chunk: Buffer) => void): this };
    write(chunk: string): boolean;
    end(): void;
    signal?(name: string): void;
  }

  export class Client {
    on(event: "ready" | "error" | "close" | "end", listener: (...args: unknown[]) => void): this;
    connect(config: ConnectConfig): void;
    exec(command: string, callback: (error: Error | undefined, stream: ExecStream | undefined) => void): void;
    end(): void;
  }
}
