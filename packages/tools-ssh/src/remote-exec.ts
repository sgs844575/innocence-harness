// 远程命令执行核心：ssh2 客户端的薄封装。连接工厂可注入（测试用假连接），
// 超时与中止语义与本地 shell 工具一致——超时/中止都结束连接并按
// timedOut 标记返回，绝不把远程进程留在不可观测状态。
import { Client, type ConnectConfig, type ExecStream } from "ssh2";

export const DEFAULT_CONNECT_TIMEOUT_MS = 15_000;
export const DEFAULT_COMMAND_TIMEOUT_MS = 120_000;
const MAX_OUTPUT_CHARS = 30_000;

export interface SshTargetOptions {
  host: string;
  port?: number;
  username: string;
  password?: string;
  privateKey?: string;
  passphrase?: string;
  /** 连接建立超时；缺省 15 秒。 */
  connectTimeoutMs?: number;
}

export interface SshExecOptions {
  command: string;
  target: SshTargetOptions;
  timeoutMs?: number;
  signal?: AbortSignal;
  maxOutputChars?: number;
}

export interface SshExecResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
}

/** 连接面：真实实现包着 ssh2 Client；测试注入假连接。 */
export interface SshConnection {
  exec(command: string): Promise<{ stdout: string; stderr: string; exitCode: number | null }>;
  end(): void;
}

export type SshConnectionFactory = (target: SshTargetOptions) => SshConnection;

function truncatingCapture(max: number): {
  push(stream: "stdout" | "stderr", chunk: string): void;
  result(): { stdout: string; stderr: string };
} {
  let stdout = "";
  let stderr = "";
  const marker = "…[已截断]";
  return {
    push(stream, chunk) {
      const total = stdout.length + stderr.length;
      if (total >= max) return;
      const room = max - total;
      const text = chunk.length > room
        ? room > marker.length
          ? `${chunk.slice(0, room - marker.length)}${marker}`
          : chunk.slice(0, room)
        : chunk;
      if (stream === "stdout") stdout += text;
      else stderr += text;
    },
    result: () => ({ stdout, stderr }),
  };
}

/** 真实连接工厂：连接就绪后才执行命令；连接层错误上抛。 */
export const nodeSshConnectionFactory: SshConnectionFactory = (target) => {
  const client = new Client();
  const connect = (): Promise<void> =>
    new Promise((resolve, reject) => {
      client.on("ready", () => resolve());
      client.on("error", (error: unknown) => reject(error));
      client.connect({
        host: target.host,
        username: target.username,
        ...(target.port !== undefined ? { port: target.port } : {}),
        ...(target.password !== undefined ? { password: target.password } : {}),
        ...(target.privateKey !== undefined ? { privateKey: target.privateKey } : {}),
        ...(target.passphrase !== undefined ? { passphrase: target.passphrase } : {}),
        ...(target.connectTimeoutMs !== undefined ? { readyTimeout: target.connectTimeoutMs } : {}),
      } satisfies ConnectConfig);
    });
  const execOnce = (command: string): Promise<{ stdout: string; stderr: string; exitCode: number | null }> =>
    new Promise((resolve, reject) => {
      client.exec(command, (error, stream) => {
        if (error || !stream) {
          reject(error ?? new Error("remote exec stream unavailable"));
          return;
        }
        const capture = truncatingCapture(MAX_OUTPUT_CHARS);
        let exitCode: number | null = null;
        stream.on("data", (chunk: Buffer) => capture.push("stdout", chunk.toString("utf8")));
        stream.stderr.on("data", (chunk: Buffer) => capture.push("stderr", chunk.toString("utf8")));
        stream.on("close", (code) => {
          exitCode = code;
          resolve({ ...capture.result(), exitCode });
        });
      });
    });
  return {
    async exec(command) {
      await connect();
      return execOnce(command);
    },
    end() {
      client.end();
    },
  };
};

/** 单命令远程执行：连接 → 执行 → 结束；超时与中止都走同一结束路径。 */
export function runRemoteCommand(options: SshExecOptions, factory: SshConnectionFactory = nodeSshConnectionFactory): Promise<SshExecResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS;
  const max = options.maxOutputChars ?? MAX_OUTPUT_CHARS;
  const capture = truncatingCapture(max);

  return new Promise((resolve) => {
    let settled = false;
    let timedOut = false;
    const connection = factory(options.target);

    const finish = (exitCode: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
      connection.end();
      const partial = capture.result();
      resolve({ ...partial, exitCode, timedOut });
    };

    const timer = setTimeout(() => {
      timedOut = true;
      finish(null);
    }, timeoutMs);

    const onAbort = () => {
      timedOut = false;
      finish(null);
    };
    options.signal?.addEventListener("abort", onAbort, { once: true });

    connection
      .exec(options.command)
      .then((result) => {
        capture.push("stdout", result.stdout);
        capture.push("stderr", result.stderr);
        finish(result.exitCode);
      })
      .catch((error: unknown) => {
        capture.push("stderr", `连接失败：${error instanceof Error ? error.message : String(error)}`);
        finish(null);
      });
  });
}

export type { ExecStream };
