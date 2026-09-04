import type { Context } from "@innocenceharness/kernel";
import { type Tool } from "@innocenceharness/harness-tools";
import {
  DEFAULT_COMMAND_TIMEOUT_MS,
  runRemoteCommand,
  nodeSshConnectionFactory,
  type SshConnectionFactory,
} from "./remote-exec";

export interface RemoteShellToolDependencies {
  /** 连接工厂注入面；缺省真实 ssh2 连接，仅测试注入。 */
  connectionFactory?: SshConnectionFactory;
}

function requireText(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`缺少必填参数 ${key}（字符串）`);
  }
  return value;
}

/** 远程 shell 工具：在可达主机上执行单条命令（认证凭据逐次提供）。 */
export function createRemoteShellTool(deps: RemoteShellToolDependencies = {}): Tool {
  return {
    name: "remote_shell",
    description:
      "在指定远程主机上执行单条 shell 命令并取回输出（用户名 + 密码或私钥认证）。" +
      "适合检查远程服务、日志与部署状态。输出超长会截断；有超时上限；失败时读取 stderr 自行修正。",
    readOnly: false,
    sideEffect: "process",
    parameters: {
      type: "object",
      properties: {
        host: { type: "string", description: "目标主机名或 IP" },
        port: { type: "integer", description: "端口（可选，默认 22）" },
        username: { type: "string", description: "登录用户名" },
        password: { type: "string", description: "密码（与 privateKey 二选一）" },
        privateKey: { type: "string", description: "私钥内容（PEM，与 password 二选一）" },
        passphrase: { type: "string", description: "私钥口令（可选）" },
        command: { type: "string", description: "要在远程主机执行的命令" },
        timeoutMs: { type: "integer", description: "超时毫秒数（可选，默认 120000）" },
      },
      required: ["host", "username", "command"],
    },
    validateArgs(args) {
      requireText(args, "host");
      requireText(args, "username");
      requireText(args, "command");
      if (
        typeof args.password !== "string" &&
        (typeof args.privateKey !== "string" || args.privateKey.trim().length === 0)
      ) {
        throw new Error("需要提供 password 或 privateKey 之一");
      }
    },
    // 权限资源以远程目标和命令为粒度。
    permissionResource(args) {
      const port = typeof args.port === "number" ? args.port : 22;
      return {
        action: "execute",
        kind: "command",
        scope: `${String(args.username)}@${String(args.host)}:${port} ${String(args.command ?? "")}`,
      };
    },
    async execute(args, ctx) {
      const command = requireText(args, "command");
      const result = await runRemoteCommand(
        {
          command,
          target: {
            host: String(args.host),
            username: String(args.username),
            ...(typeof args.port === "number" ? { port: args.port } : {}),
            ...(typeof args.password === "string" ? { password: args.password } : {}),
            ...(typeof args.privateKey === "string" ? { privateKey: args.privateKey } : {}),
            ...(typeof args.passphrase === "string" ? { passphrase: args.passphrase } : {}),
          },
          timeoutMs: typeof args.timeoutMs === "number" ? args.timeoutMs : undefined,
          signal: ctx.signal,
        },
        deps.connectionFactory ?? nodeSshConnectionFactory,
      );
      const parts: string[] = [];
      if (result.stdout) parts.push(result.stdout);
      if (result.stderr) parts.push(`[stderr]\n${result.stderr}`);
      if (result.timedOut) {
        const seconds = Math.round(
          (typeof args.timeoutMs === "number" ? args.timeoutMs : DEFAULT_COMMAND_TIMEOUT_MS) / 1000,
        );
        parts.push(`[命令超时被终止（>${seconds}s）]`);
      }
      const ok = !result.timedOut && result.exitCode === 0;
      return {
        content: parts.join("\n") || "[无输出，退出码 0]",
        isError: !ok,
      };
    },
  };
}

/** Shell-style plugin factory (host composition may register custom transports). */
export function createSshToolsPlugin(deps: RemoteShellToolDependencies = {}) {
  const tool = createRemoteShellTool(deps);
  return {
    name: "ssh" as const,
    apply(ctx: Context) {
      ctx.tools.register(tool);
    },
  };
}

/**
 * Declarative plugin (default export): mounts like the local shell tool with
 * no host-side configuration, so manifest-driven boot can mount it directly.
 */
export const SshPlugin = createSshToolsPlugin();
export default SshPlugin;
