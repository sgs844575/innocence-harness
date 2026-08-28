import { spawn, type ChildProcess } from "node:child_process";
import type { Context } from "@innocenceharness/kernel";
import {
  redactCommandSummary,
  sha256Hex,
  type Tool,
  type ToolContext,
} from "@innocenceharness/harness-tools";

const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_OUTPUT_CHARS = 30_000;

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

interface ShellTranscriptRegistry {
  listeners: Set<(event: ShellTranscriptEvent) => void>;
}

const shellTranscriptRegistryKey = Symbol.for("innocenceharness.tools-shell.transcript");

function shellTranscriptRegistry(): ShellTranscriptRegistry {
  const global = globalThis as typeof globalThis & {
    [shellTranscriptRegistryKey]?: ShellTranscriptRegistry;
  };
  return (global[shellTranscriptRegistryKey] ??= { listeners: new Set() });
}

export function subscribeShellTranscript(listener: (event: ShellTranscriptEvent) => void): () => void {
  const registry = shellTranscriptRegistry();
  registry.listeners.add(listener);
  return () => registry.listeners.delete(listener);
}

function publishShellTranscript(event: ShellTranscriptEvent): void {
  for (const listener of [...shellTranscriptRegistry().listeners]) listener(event);
}

/** Kills the whole process tree — shell:true spawns a wrapper shell whose
 *  children survive a plain kill() on Windows. */
function killTree(child: ChildProcess): void {
  if (child.pid === undefined) return;
  if (process.platform === "win32") {
    spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
    });
  } else {
    child.kill("SIGKILL");
  }
}

export interface RunCommandOptions {
  command: string;
  cwd: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  maxOutputChars?: number;
  onOutput?: (stream: "stdout" | "stderr", data: string) => void;
}

export interface RunCommandResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
}

/** Runs a shell command with timeout, abort and truncated capture. */
export function runCommand(options: RunCommandOptions): Promise<RunCommandResult> {
  const { command, cwd, timeoutMs = DEFAULT_TIMEOUT_MS, signal } = options;
  const max = options.maxOutputChars ?? MAX_OUTPUT_CHARS;
  const isWindows = process.platform === "win32";
  const child = spawn(command, {
    shell: true,
    cwd,
    windowsHide: true,
    env: { ...process.env, ...(isWindows ? {} : { shell: "/bin/sh" }) },
  });

  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;

    const capture = (kind: "stdout" | "stderr", chunk: string) => {
      const total = stdout.length + stderr.length;
      if (total >= max) return;
      const room = max - total;
      const marker = "…[已截断]";
      const truncated = chunk.length > room;
      const text = truncated
        ? room > marker.length
          ? `${chunk.slice(0, room - marker.length)}${marker}`
          : chunk.slice(0, room)
        : chunk;
      if (kind === "stdout") stdout += text;
      else stderr += text;
      options.onOutput?.(kind, text);
    };

    child.stdout?.on("data", (d: Buffer) => capture("stdout", d.toString("utf8")));
    child.stderr?.on("data", (d: Buffer) => capture("stderr", d.toString("utf8")));

    const finish = (exitCode: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      resolve({ stdout, stderr, exitCode, timedOut });
    };

    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child);
    }, timeoutMs);

    const onAbort = () => {
      timedOut = false;
      killTree(child);
    };
    signal?.addEventListener("abort", onAbort, { once: true });

    child.on("error", (err) => {
      capture("stderr", `spawn 失败：${err.message}`);
      finish(null);
    });
    child.on("close", (code) => finish(code));
  });
}

/** Bash-like shell tool: runs commands in the workspace root. */
export const bashTool: Tool = {
  name: "Bash",
  description:
    "在工作区目录执行 shell 命令（Windows 用 cmd，其他平台用 sh）。适合跑测试、构建、装依赖。" +
    "输出超长会截断；命令有超时上限。失败时读取 stderr 自行修正。",
  readOnly: false,
  sideEffect: "process",
  parameters: {
    type: "object",
    properties: {
      command: { type: "string", description: "要执行的命令" },
      timeoutMs: { type: "integer", description: "超时毫秒数（可选，默认 120000）" },
    },
    required: ["command"],
  },
  async validateArgs(args) {
    const command = args.command;
    if (typeof command !== "string" || command.trim().length === 0) {
      throw new Error("缺少必填参数 command（字符串）");
    }
  },
  permissionResource(args) {
    // scope 与持久化摘要同粒度（程序词 + 合法形状 subcommand）：会话授权
    // 因此区分 npm test 与 npm publish；完整命令绝不进入资源。
    return {
      action: "execute",
      kind: "command",
      scope: redactCommandSummary(String(args.command ?? "")),
    };
  },
  persistArgs(args) {
    const command = requireCommand(args);
    // 保存脱敏命令摘要（程序词 + 合法形状的 subcommand token）和命令哈希；
    // 完整命令与参数值绝不持久化，项目规则按摘要前缀匹配。
    return {
      command: redactCommandSummary(command),
      commandSha256: sha256Hex(command),
    };
  },
  async execute(args, ctx: ToolContext) {
    const command = requireCommand(args);
    const scope = ctx.scope;
    const identity = {
      sessionId: scope.sessionId ?? "",
      taskId: scope.taskId ?? "",
      routeId: scope.routeId ?? "main",
      invocationId: scope.invocationId,
    };
    publishShellTranscript({ type: "started", ...identity, command });
    const result = await runCommand({
      command,
      cwd: ctx.workspaceRoot,
      timeoutMs: typeof args.timeoutMs === "number" ? args.timeoutMs : undefined,
      signal: ctx.signal,
      onOutput: (stream, data) => publishShellTranscript({ type: "output", ...identity, data, stream }),
    });
    const parts: string[] = [];
    if (result.stdout) parts.push(result.stdout);
    if (result.stderr) parts.push(`[stderr]\n${result.stderr}`);
    if (result.timedOut) parts.push(`[命令超时被终止（>${Math.round((typeof args.timeoutMs === "number" ? args.timeoutMs : DEFAULT_TIMEOUT_MS) / 1000)}s）]`);
    const ok = !result.timedOut && result.exitCode === 0;
    publishShellTranscript({
      type: "completed",
      ...identity,
      exitCode: result.exitCode,
      timedOut: result.timedOut,
      ...(ok ? {} : { error: result.timedOut ? "command timed out" : "command failed" }),
    });
    return {
      content: parts.join("\n") || "[无输出，退出码 0]",
      isError: !ok,
    };
  },
};

function requireCommand(args: Record<string, unknown>): string {
  const command = args.command;
  if (typeof command !== "string" || command.trim().length === 0) {
    throw new Error("缺少必填参数 command（字符串）");
  }
  return command;
}

/** Shell tools plugin — registers the Bash tool. */
export const ShellPlugin = {
  name: "shell",
  apply(ctx: Context) {
    ctx.tools.register(bashTool);
  },
};
export default ShellPlugin;
