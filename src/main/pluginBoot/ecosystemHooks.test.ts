// 生态 hooks/hooks.json 装载测试（turnEnd 波）：夹具 bundle 的 hooks 声明
// 经适配层解析并以运行时端口挂载为钩子插件；端口缺席时按告警跳过。
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Context, type ObjectPlugin } from "@innocenceharness/kernel";
import { applyBundleHooks, type BundleRuntimePort } from "./bundleCapabilities";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function bundleWithHooks(document: unknown): string {
  const dir = mkdtempSync(path.join(tmpdir(), "bundle-hooks-"));
  dirs.push(dir);
  mkdirSync(path.join(dir, "hooks"), { recursive: true });
  writeFileSync(path.join(dir, "hooks", "hooks.json"), JSON.stringify(document), "utf8");
  return dir;
}

interface Mount {
  ctx: Context;
  hooks: unknown[];
  plugins: ObjectPlugin[];
}

function fakeMount(): Mount & { port: BundleRuntimePort } {
  const mounted: Mount = { ctx: {} as Context, hooks: [], plugins: [] };
  const port: BundleRuntimePort = {
    getDataRoot: () => "",
    createServers: () => {
      throw new Error("no servers in this fixture");
    },
    createHooks: (hooks) => {
      mounted.hooks.push(hooks);
      const plugin: ObjectPlugin = {
        name: "fixture:hooks",
        apply(ctx) {
          mounted.ctx = ctx;
          mounted.plugins.push(plugin);
        },
      };
      return plugin;
    },
  };
  return { ...mounted, port };
}

function logSink() {
  const lines: Array<{ level: string; channel: string; detail: Record<string, unknown> }> = [];
  return {
    lines,
    log: (level: "warn", channel: string, detail: Record<string, unknown>) =>
      lines.push({ level, channel, detail }),
  };
}

describe("applyBundleHooks", () => {
  it("owns the hook disposer until its enclosing scope ends", async () => {
    const dir = bundleWithHooks({ hooks: { SessionStop: [{ hooks: [{ type: "command", command: "finish" }] }] } });
    const ctx = new Context();
    let disposed = 0;
    const mount = fakeMount();
    mount.port.createHooks = () => ({ name: "cleanup", apply: () => async () => { disposed++; } });
    expect(await applyBundleHooks(ctx, "fixture", dir, mount.port, logSink().log)).toBe(true);
    expect(disposed).toBe(0);
    await ctx.fiber.dispose();
    await ctx.fiber.dispose();
    expect(disposed).toBe(1);
  });
  it("mounts a mapped hooks document through the runtime port", async () => {
    const dir = bundleWithHooks({
      hooks: {
        PreToolUse: [{ matcher: "Write", hooks: [{ type: "command", command: "guard.sh" }] }],
        Stop: [{ hooks: [{ type: "command", command: "turn.sh", timeout: 2 }] }],
      },
    });
    const mount = fakeMount();
    const sink = logSink();
    const applied = await applyBundleHooks(mount.ctx, "bundle-x", dir, mount.port, sink.log);
    expect(applied).toBe(true);
    expect(mount.hooks).toEqual([[
      {
        event: "preToolCall",
        command: "guard.sh",
        commandTokens: ["guard.sh"],
        match: "Write",
        matchKind: "regex",
      },
      { event: "turnEnd", command: "turn.sh", commandTokens: ["turn.sh"], timeoutMs: 2000 },
    ]]);
    expect(mount.plugins).toHaveLength(1);
    expect(sink.lines).toEqual([]);
  });

  it("surfaces parse warnings but still mounts the healthy subset", async () => {
    const dir = bundleWithHooks({
      hooks: {
        PreToolUse: [{ hooks: [{ type: "command", command: "ok.sh" }, { type: "remote" }] }],
      },
    });
    const mount = fakeMount();
    const sink = logSink();
    await applyBundleHooks(mount.ctx, "bundle-x", dir, mount.port, sink.log);
    expect(mount.hooks).toEqual([[{ event: "preToolCall", command: "ok.sh", commandTokens: ["ok.sh"] }]]);
    expect(sink.lines).toHaveLength(1);
    expect(sink.lines[0]).toMatchObject({ channel: "bundle hooks" });
  });

  it("is a no-op without a hooks.json or without port support", async () => {
    const bare = mkdtempSync(path.join(tmpdir(), "bundle-bare-"));
    dirs.push(bare);
    const mount = fakeMount();
    const sink = logSink();
    expect(await applyBundleHooks(mount.ctx, "bundle-x", bare, mount.port, sink.log)).toBe(false);
    const dir = bundleWithHooks({ hooks: { Stop: [{ hooks: [{ type: "command", command: "x" }] }] } });
    const withoutPort: BundleRuntimePort = {
      getDataRoot: () => "",
      createServers: () => {
        throw new Error("unused");
      },
    };
    expect(await applyBundleHooks(mount.ctx, "bundle-x", dir, withoutPort, sink.log)).toBe(false);
    expect(mount.hooks).toEqual([]);
    expect(sink.lines).toEqual([]);
  });
});
