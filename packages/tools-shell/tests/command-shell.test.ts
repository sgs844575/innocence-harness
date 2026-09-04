// commandShell 工厂配置的 spawn 形状：提供时 spawn(file, [...args, command],
// { shell:false })；缺省保持 { shell:true } 平台展开。child_process.spawn
// 全程打桩，不孵化真实进程。
import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";

const spawnCalls = vi.hoisted(() => [] as unknown[][]);

vi.mock("node:child_process", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:child_process")>();
  return {
    ...original,
    spawn: vi.fn((...args: unknown[]) => {
      spawnCalls.push(args);
      const child = new EventEmitter() as unknown as Record<string, unknown>;
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.pid = 4321;
      child.kill = vi.fn();
      queueMicrotask(() => (child as unknown as EventEmitter).emit("close", 0));
      return child;
    }),
  };
});

import { createBashTool, runCommand } from "../src";
import { createExecutionScope, type ToolContext } from "@innocenceharness/harness-tools";

const ctx = (): ToolContext => ({
  workspaceRoot: "D:\\work",
  signal: new AbortController().signal,
  log: () => {},
  scope: createExecutionScope("Bash"),
});

describe("runCommand commandShell spawn shape", () => {
  it("default: single-string spawn with { shell: true }", async () => {
    spawnCalls.length = 0;
    const result = await runCommand({ command: "echo hi", cwd: "D:\\work" });
    expect(result.exitCode).toBe(0);
    expect(spawnCalls).toHaveLength(1);
    const [file, options] = spawnCalls[0] as [string, { shell: boolean; cwd: string; windowsHide: boolean }];
    expect(file).toBe("echo hi");
    expect(options).toMatchObject({ shell: true, cwd: "D:\\work", windowsHide: true });
  });

  it("commandShell: prefix template spawn with { shell: false }", async () => {
    spawnCalls.length = 0;
    await runCommand({
      command: "echo hi",
      cwd: "D:\\work",
      commandShell: { file: "C:\\Git\\bin\\bash.exe", args: ["--login", "-c"] },
    });
    expect(spawnCalls).toHaveLength(1);
    const [file, args, options] = spawnCalls[0] as [string, string[], { shell: boolean; cwd: string; windowsHide: boolean }];
    expect(file).toBe("C:\\Git\\bin\\bash.exe");
    expect(args).toEqual(["--login", "-c", "echo hi"]);
    expect(options).toMatchObject({ shell: false, cwd: "D:\\work", windowsHide: true });
  });

  it("createBashTool carries the factory config into execute", async () => {
    spawnCalls.length = 0;
    const tool = createBashTool({ commandShell: { file: "powershell.exe", args: ["-NoProfile", "-Command"] } });
    const result = await tool.execute({ command: "Get-Location" }, ctx());
    expect(result.isError).toBe(false);
    const [file, args, options] = spawnCalls[0] as [string, string[], { shell: boolean }];
    expect(file).toBe("powershell.exe");
    expect(args).toEqual(["-NoProfile", "-Command", "Get-Location"]);
    expect(options.shell).toBe(false);
  });

  it("zero-config bashTool keeps the default spawn shape", async () => {
    spawnCalls.length = 0;
    const tool = createBashTool();
    await tool.execute({ command: "echo hi" }, ctx());
    const [file, options] = spawnCalls[0] as [string, { shell: boolean }];
    expect(file).toBe("echo hi");
    expect(options.shell).toBe(true);
  });
});
