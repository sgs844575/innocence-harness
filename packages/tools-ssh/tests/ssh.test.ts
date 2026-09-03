import { describe, expect, it, vi } from "vitest";
import type { Context } from "@innocenceharness/kernel";
import { runRemoteCommand, type SshConnection, type SshConnectionFactory, type SshTargetOptions } from "../src/remote-exec";
import { createRemoteShellTool, createSshToolsPlugin } from "../src/index";

function fakeFactory(handler: (command: string) => Promise<{ stdout: string; stderr: string; exitCode: number | null }>): { factory: SshConnectionFactory; connection: FakeConnection } {
  const connection = new FakeConnection(handler);
  return { factory: () => connection, connection };
}

class FakeConnection implements SshConnection {
  ended = false;
  constructor(private readonly handler: (command: string) => Promise<{ stdout: string; stderr: string; exitCode: number | null }>) {}
  exec(command: string): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
    return this.handler(command);
  }
  end(): void {
    this.ended = true;
  }
}

const target: SshTargetOptions = { host: "host.invalid", username: "ops", password: "pw" };

describe("runRemoteCommand", () => {
  it("captures stdout, stderr and exit code, then ends the connection", async () => {
    const { factory, connection } = fakeFactory(async () => ({ stdout: "hello", stderr: "warn", exitCode: 0 }));
    const result = await runRemoteCommand({ command: "uptime", target }, factory);
    expect(result).toEqual({ stdout: "hello", stderr: "warn", exitCode: 0, timedOut: false });
    expect(connection.ended).toBe(true);
  });

  it("surfaces connection failures as stderr with a null exit code", async () => {
    const { factory, connection } = fakeFactory(async () => {
      throw new Error("all authentication methods failed");
    });
    const result = await runRemoteCommand({ command: "uptime", target }, factory);
    expect(result.exitCode).toBeNull();
    expect(result.stderr).toContain("all authentication methods failed");
    expect(result.timedOut).toBe(false);
    expect(connection.ended).toBe(true);
  });

  it("marks timeouts and ends the connection", async () => {
    const { factory, connection } = fakeFactory(() => new Promise(() => undefined));
    const result = await runRemoteCommand({ command: "sleep 999", target, timeoutMs: 30 }, factory);
    expect(result.timedOut).toBe(true);
    expect(result.exitCode).toBeNull();
    expect(connection.ended).toBe(true);
  });

  it("ends the connection when the signal aborts mid-run", async () => {
    const { factory, connection } = fakeFactory(() => new Promise(() => undefined));
    const controller = new AbortController();
    const done = runRemoteCommand({ command: "tail -f x", target, signal: controller.signal }, factory);
    controller.abort();
    const result = await done;
    expect(result.timedOut).toBe(false);
    expect(result.exitCode).toBeNull();
    expect(connection.ended).toBe(true);
  });
});

describe("remote_shell tool", () => {
  const ctx = {
    scope: { sessionId: "s", taskId: "t", routeId: "main", invocationId: "i" },
    workspaceRoot: "/ws",
    signal: new AbortController().signal,
  } as unknown as Parameters<ReturnType<typeof createRemoteShellTool>["execute"]>[1];

  it("validates required arguments and credential shape", () => {
    const tool = createRemoteShellTool();
    expect(() => tool.validateArgs?.({ host: "h", username: "u", command: "ls" })).toThrow("password 或 privateKey");
    expect(() =>
      tool.validateArgs?.({ host: "h", username: "u", command: "ls", password: "p" }),
    ).not.toThrow();
    expect(() => tool.validateArgs?.({ username: "u", password: "p", command: "ls" })).toThrow("host");
  });

  it("executes through the injected factory and reports failure via isError", async () => {
    const exec = vi.fn(async () => ({ stdout: "", stderr: "permission denied", exitCode: 1 }));
    const tool = createRemoteShellTool({ connectionFactory: () => ({ exec, end: () => undefined }) });
    const result = await tool.execute(
      { host: "h", username: "ops", password: "p", command: "ls /root" },
      ctx,
    );
    expect(exec).toHaveBeenCalledWith("ls /root");
    expect(result.isError).toBe(true);
    expect(result.content).toContain("permission denied");
  });

  it("persists the full target and command; declared credential fields never persist", () => {
    const tool = createRemoteShellTool();
    const persisted = tool.persistArgs?.({
      host: "secret-host",
      username: "ops",
      password: "super-secret",
      command: "cat /etc/hostname",
    });
    expect(persisted).toMatchObject({ target: "ops@secret-host:22", command: "cat /etc/hostname" });
    expect(JSON.stringify(persisted)).not.toContain("super-secret");
  });

  it("registers the tool under the plugin name ssh", () => {
    const registered: unknown[] = [];
    const ctx = { tools: { register: (tool: unknown) => registered.push(tool) } } as unknown as Context;
    const plugin = createSshToolsPlugin({
      connectionFactory: () => ({ exec: async () => ({ stdout: "", stderr: "", exitCode: 0 }), end: () => undefined }),
    });
    plugin.apply(ctx);
    expect(registered).toHaveLength(1);
    expect(plugin.name).toBe("ssh");
  });
});
