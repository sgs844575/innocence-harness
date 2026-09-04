import { spawn, type ChildProcess } from "node:child_process";
import type { Context } from "@innocenceharness/kernel";
import {
  type Tool,
  type ToolContext,
} from "@innocenceharness/harness-tools";
import { createOutputDecoder, windowsAnsiEncoding } from "./output-decoder";

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
  /**
   * Host-resolved command shell prefix（terminalShell 设置经组合根解析注入）：
   * 提供时以 `spawn(file, [...args, command], { shell: false })` 执行——file
   * 即 shell 本体、args 已含命令行标志；缺省保持 Node 的 `{ shell: true }`
   * 平台默认展开。tools-shell 不感知具体 shell 种类，只消费这个模板。
   */
  commandShell?: { file: string; args: string[] };
}

export interface RunCommandResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
}

/** Runs a shell command with timeout, abort and truncated capture. Output bytes
 *  are decoded per stream: UTF-8, falling back to the Windows console codepage
 *  (e.g. GBK on zh-CN) when the bytes are not valid UTF-8. */
export async function runCommand(options: RunCommandOptions): Promise<RunCommandResult> {
  const { command, cwd, timeoutMs = DEFAULT_TIMEOUT_MS, signal } = options;
  const max = options.maxOutputChars ?? MAX_OUTPUT_CHARS;
  const isWindows = process.platform === "win32";
  // 先取代码页再 spawn：仅 Windows 首次调用有一次 chcp 探测，之后走缓存。
  const ansiEncoding = await windowsAnsiEncoding();
  const env = { ...process.env, ...(isWindows ? {} : { shell: "/bin/sh" }) };
  const child = options.commandShell
    ? spawn(options.commandShell.file, [...options.commandShell.args, command], {
      shell: false,
      cwd,
      windowsHide: true,
      env,
    })
    : spawn(command, {
      shell: true,
      cwd,
      windowsHide: true,
      env,
    });

  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
    const stdoutDecoder = createOutputDecoder(ansiEncoding);
    const stderrDecoder = createOutputDecoder(ansiEncoding);

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

    child.stdout?.on("data", (d: Buffer) => capture("stdout", stdoutDecoder.push(d)));
    child.stderr?.on("data", (d: Buffer) => capture("stderr", stderrDecoder.push(d)));

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
    child.on("close", (code) => {
      // 冲刷解码器暂存（跨块的不完整多字节序列）后再收尾。
      const tailOut = stdoutDecoder.end();
      if (tailOut) capture("stdout", tailOut);
      const tailErr = stderrDecoder.end();
      if (tailErr) capture("stderr", tailErr);
      finish(code);
    });
  });
}

/** shell 插件工厂配置：宿主按 terminalShell 设置解析的命令 shell 模板。 */
export interface ShellPluginConfig {
  commandShell?: { file: string; args: string[] };
}

/** Bash-like shell tool: runs commands in the workspace root. */
export function createBashTool(config: ShellPluginConfig = {}): Tool {
  const commandShell = config.commandShell;
  return {
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
      // scope 与持久化同粒度：完整命令原文（项目规则按 token 前缀匹配）。
      return {
        action: "execute",
        kind: "command",
        scope: String(args.command ?? ""),
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
        ...(commandShell ? { commandShell } : {}),
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
}

/** Zero-config Bash tool（默认 { shell: true } 平台展开）。 */
export const bashTool: Tool = createBashTool();

function requireCommand(args: Record<string, unknown>): string {
  const command = args.command;
  if (typeof command !== "string" || command.trim().length === 0) {
    throw new Error("缺少必填参数 command（字符串）");
  }
  return command;
}

/**
 * Shell tools plugin factory — registers the Bash tool. The staged default
 * export is THIS factory: hosts assemble the command shell from the session's
 * settings snapshot (terminalShell → resolveCommandShell in the composition
 * root); zero-config keeps the platform default `{ shell: true }` spawn.
 */
export function createShellPlugin(config: ShellPluginConfig = {}) {
  return {
    name: "shell",
    apply(ctx: Context) {
      ctx.tools.register(createBashTool(config));
    },
  };
}

/** Zero-config plugin（默认 { shell: true } 平台展开）。 */
export const ShellPlugin = createShellPlugin();

// Distribution default (kernel-loader unwrapExports convention): the factory,
// so a disk-loaded module resolves to the single entry point hosts configure.
export default createShellPlugin;
