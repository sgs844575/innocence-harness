// 测试公共件：进程执行替身与最小 ToolContext 桩（本包工具只消费 signal）。
import type { ToolContext } from "@innocenceharness/harness-tools";
import type { CommandRunner, ProcessRunResult } from "../src/runner";

export interface RunnerCall {
  script: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}

/**
 * 假执行器：记录每次调用并按入参回放结果（默认 exit 0、无输出）。
 * respond 传部分结果补丁或按调用定制结果的函数。
 */
export function fakeRunner(
  respond: Partial<ProcessRunResult> | ((call: RunnerCall) => Partial<ProcessRunResult>) = {},
): { runner: CommandRunner; calls: RunnerCall[] } {
  const calls: RunnerCall[] = [];
  const runner: CommandRunner = async (opts) => {
    calls.push(opts);
    const patch = typeof respond === "function" ? respond(opts) : respond;
    return { exitCode: 0, stdout: "", stderr: "", ...patch };
  };
  return { runner, calls };
}

/** 最小 ToolContext 替身：工具执行路径只读取 signal。 */
export function stubCtx(): ToolContext {
  return {
    workspaceRoot: "C:\\tmp-ws",
    signal: new AbortController().signal,
    log: () => {},
  } as unknown as ToolContext;
}

/** 从脚本里取出 base64 嵌入的字符串并解码回原文。 */
export function embeddedValue(script: string): string {
  const match = /FromBase64String\('([A-Za-z0-9+/=]+)'\)/.exec(script);
  if (!match) throw new Error(`script carries no base64 argument: ${script.slice(0, 200)}`);
  return Buffer.from(match[1], "base64").toString("utf8");
}
