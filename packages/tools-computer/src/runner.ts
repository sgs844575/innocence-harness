// 进程执行面：本包唯一的外部命令入口。注入为 CommandRunner，工具与测试
// 都面向该接口编程；真实实现经 powershell.exe 执行脚本（无 shell 中间层，
// 脚本整体作为单个 argv 传入）。输出按字节累积、超限杀进程，超时与中止
// 同样杀进程，避免失控进程残留。
import { spawn } from "node:child_process";

/** 一次进程执行的归一化结果。 */
export interface ProcessRunResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  /** true 表示由超时杀进程结束（abort 杀进程不计入此项）。 */
  timedOut?: boolean;
}

export interface CommandRunnerOptions {
  script: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}

/** 可注入的进程执行口（测试替身/宿主自定义实现）。 */
export type CommandRunner = (opts: CommandRunnerOptions) => Promise<ProcessRunResult>;

const DEFAULT_TIMEOUT_MS = 15_000;
/** stdout/stderr 各自的累积上限，超出即杀进程（防失控输出撑爆内存）。 */
const DEFAULT_OUTPUT_LIMIT_BYTES = 256 * 1024;

/** 真实执行器：powershell.exe 无配置、非交互、旁路执行策略、隐藏窗口。 */
export function createPowershellRunner(): CommandRunner {
  return (opts) => runPowershell(opts);
}

function runPowershell({
  script,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  signal,
}: CommandRunnerOptions): Promise<ProcessRunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
      { windowsHide: true },
    );
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let timedOut = false;
    let settled = false;

    // 杀进程是幂等的；child.kill() 在进程已退出时安全返回 false。
    const kill = () => {
      child.kill();
    };

    // 中止：立刻杀；监听在收尾时摘除，避免跨调用的监听器泄漏。
    if (signal) {
      if (signal.aborted) kill();
      else signal.addEventListener("abort", kill, { once: true });
    }
    const timer = setTimeout(() => {
      timedOut = true;
      kill();
    }, timeoutMs);

    // 字节预算检查在 chunk 粒度（粗于字节但恒为上限的保守近似）。
    child.stdout?.on("data", (chunk: Buffer) => {
      stdoutChunks.push(chunk);
      stdoutBytes += chunk.length;
      if (stdoutBytes > DEFAULT_OUTPUT_LIMIT_BYTES) kill();
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderrChunks.push(chunk);
      stderrBytes += chunk.length;
      if (stderrBytes > DEFAULT_OUTPUT_LIMIT_BYTES) kill();
    });

    const settle = (failure: Error | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", kill);
      if (failure) {
        reject(failure);
        return;
      }
      const result: ProcessRunResult = {
        exitCode: child.exitCode,
        stdout: Buffer.concat(stdoutChunks).toString("utf8"),
        stderr: Buffer.concat(stderrChunks).toString("utf8"),
      };
      if (timedOut) result.timedOut = true;
      resolve(result);
    };

    // stdin 无人写入：立刻关闭父侧句柄，避免无谓的管道保持。
    child.stdin?.end();
    child.on("error", (error) => settle(error));
    child.on("close", () => settle(null));
  });
}
