// 终端 shell 注入：默认 manager 的 createSession 包装把 getShellLaunch 的解
// 析结果作为 init.shell 传给 LivePtySession（仅新建终端生效）。
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PtySessionFactory } from "@innocenceharness/terminal-pty";

type SessionInit = Parameters<PtySessionFactory>[0];

const { managerOptions, liveSessionInits } = vi.hoisted(() => ({
  managerOptions: [] as {
    onEvent?: (event: unknown) => void;
    createSession?: (init: SessionInit, options: unknown) => unknown;
  }[],
  liveSessionInits: [] as SessionInit[],
}));

vi.mock("@innocenceharness/terminal-pty", async (importOriginal) => {
  const original = await importOriginal<typeof import("@innocenceharness/terminal-pty")>();
  return {
    ...original,
    createPtyManager: (options: (typeof managerOptions)[number]) => {
      managerOptions.push(options);
      return {
        create: vi.fn(),
        get: vi.fn(),
        disposeForRoute: vi.fn(),
        disposeAll: vi.fn(),
      };
    },
    LivePtySession: class {
      constructor(init: SessionInit) {
        liveSessionInits.push(init);
      }
    },
  };
});

vi.mock("@innocenceharness/tools-shell", () => ({
  subscribeShellTranscript: () => () => {},
}));

import { createTerminalIpcService } from "./terminalIpc";
import { createDockTerminalIpcService } from "./dockTerminalIpc";

const init: SessionInit = {
  ptyId: "pty_1",
  taskId: "t1",
  routeId: "r1",
  cwd: "C:\\work",
  cols: 80,
  rows: 24,
};

afterEach(() => {
  managerOptions.length = 0;
  liveSessionInits.length = 0;
});

describe("terminal shell wiring", () => {
  it("route-bound 服务：getShellLaunch 解析结果注入 init.shell", () => {
    createTerminalIpcService({
      resolveRouteCwd: async () => "C:\\work",
      send: () => {},
      getShellLaunch: () => ({ file: "C:\\Git\\bin\\bash.exe", args: ["--login", "-i"] }),
    });
    expect(managerOptions).toHaveLength(1);
    managerOptions[0]!.createSession!(init, {});
    expect(liveSessionInits[0]!.shell).toEqual({ file: "C:\\Git\\bin\\bash.exe", args: ["--login", "-i"] });
  });

  it("route-bound 服务：未配置 getShellLaunch → init.shell 为 undefined（平台默认回落）", () => {
    createTerminalIpcService({
      resolveRouteCwd: async () => "C:\\work",
      send: () => {},
    });
    managerOptions[0]!.createSession!(init, {});
    expect(liveSessionInits[0]!.shell).toBeUndefined();
  });

  it("dock 服务：getShellLaunch 解析结果注入 init.shell", () => {
    createDockTerminalIpcService({
      send: () => {},
      getShellLaunch: () => ({ file: "powershell.exe", args: [] }),
    });
    expect(managerOptions).toHaveLength(1);
    managerOptions[0]!.createSession!(init, {});
    expect(liveSessionInits[0]!.shell).toEqual({ file: "powershell.exe", args: [] });
  });

  it("两个服务的 shell 惰性解析：每次新建都现取（设置变更只影响新终端）", () => {
    let shell = { file: "cmd.exe", args: [] as string[] };
    createTerminalIpcService({
      resolveRouteCwd: async () => "C:\\work",
      send: () => {},
      getShellLaunch: () => shell,
    });
    managerOptions[0]!.createSession!(init, {});
    shell = { file: "wsl.exe", args: [] };
    managerOptions[0]!.createSession!(init, {});
    expect(liveSessionInits[0]!.shell).toEqual({ file: "cmd.exe", args: [] });
    expect(liveSessionInits[1]!.shell).toEqual({ file: "wsl.exe", args: [] });
  });
});
