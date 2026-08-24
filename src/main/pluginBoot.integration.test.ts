// pluginBoot staging 装载集成（T11 验收 + T12 单实例显式验收）：Node 级、
// 不起 Electron——经真实 staging 树（npm run build:plugins 产出）装载内核、
// 脊柱套件与至少 fs/shell 两插件。无 staging 的干净检出按 packaged-exit
// 先例设计性跳过。
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, describe, expect, it, vi } from "vitest";
import { AgentSession, type SessionPlugin } from "@innocenceharness/harness-electron";
import { createMockProvider } from "@innocenceharness/provider-mock";
import {
  createPluginBoot,
  createSessionComposition,
  loadKernel,
  resetKernelCache,
  type PluginBoot,
} from "./pluginBoot";
import { stagingBootPaths } from "./staging-paths";

const paths = stagingBootPaths();

describe("staging namespace", () => {
  it("resolves the kernel from the new workspace scope only", () => {
    expect(paths.kernelPath).toBe(path.join(
      process.cwd(), "build", "dist", "resources", "node_modules", "@innocenceharness", "kernel", "dist", "index.js",
    ));
    expect(existsSync(paths.kernelPath)).toBe(true);
    const retiredScope = "@innocence" + "code";
    expect(existsSync(path.join(
      process.cwd(), "build", "dist", "resources", "node_modules", retiredScope, "kernel", "dist", "index.js",
    ))).toBe(false);
  });
});
const stagingAvailable = existsSync(paths.kernelPath);
const maybeDescribe = stagingAvailable ? describe : describe.skip;

let boot: PluginBoot | undefined;
let userRoot: string | undefined;
const roots: string[] = [];
afterAll(async () => {
  await boot?.dispose().catch(() => {});
  if (userRoot) rmSync(userRoot, { recursive: true, force: true });
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

async function ensureBoot(): Promise<PluginBoot> {
  if (!boot) {
    userRoot = mkdtempSync(path.join(tmpdir(), "ic-boot-user-"));
    boot = await createPluginBoot({
      kernelPath: paths.kernelPath,
      builtinRoot: paths.builtinRoot,
      userRoot,
      workspaceRoot: process.cwd(),
    });
  }
  return boot;
}

async function waitUntil(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("condition did not settle");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

maybeDescribe("pluginBoot over the real staging tree", () => {
  it("loads the staging kernel (single module instance) with createScope", async () => {
    const b = await ensureBoot();
    expect(typeof b.kernel.createScope).toBe("function");
    expect(b.kernel.Context).toBeTypeOf("function");
    const scope = b.createSessionScope();
    expect(scope.ctx.fiber).not.toBe(b.root.fiber);
    await scope.dispose();
  });

  it("mounts fs and shell at the boot root through loader.create", async () => {
    const b = await ensureBoot();
    await b.mountAtRoot("fs");
    await b.mountAtRoot("shell");
    const names = b.root.tools.specs().map((spec) => spec.name).sort();
    // The root spine backed the disk-loaded plugins: their tools registered.
    expect(names).toContain("Bash");
    expect(names).toEqual(
      expect.arrayContaining(["Edit", "Glob", "Grep", "Read", "Write"]),
    );
  });

  it("connects a real development watcher and disposes it before root teardown", async () => {
    const isolatedUserRoot = mkdtempSync(path.join(tmpdir(), "ic-boot-hmr-user-"));
    const isolatedBoot = await createPluginBoot({
      kernelPath: paths.kernelPath,
      builtinRoot: paths.builtinRoot,
      userRoot: isolatedUserRoot,
      workspaceRoot: process.cwd(),
      enableHmrWatcher: true,
    });
    const fixtureRoot = mkdtempSync(path.join(tmpdir(), "ic-boot-hmr-fixture-"));
    roots.push(fixtureRoot);
    const fixture = path.join(fixtureRoot, "client.js");
    writeFileSync(fixture, "initial", "utf8");
    let restarts = 0;
    await isolatedBoot.watchPlugin("example", fixture, async () => { restarts += 1; });
    writeFileSync(fixture, "changed", "utf8");
    await waitUntil(() => restarts === 1);
    await isolatedBoot.dispose();
    writeFileSync(fixture, "after-dispose", "utf8");
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(restarts).toBe(1);
    rmSync(isolatedUserRoot, { recursive: true, force: true });
  });

  it("does not create a watcher in production mode", async () => {
    const factory = vi.fn(() => ({
      watchPath: async () => async () => {},
      dispose: async () => {},
    }));
    vi.stubEnv("NODE_ENV", "production");
    const isolatedUserRoot = mkdtempSync(path.join(tmpdir(), "ic-boot-prod-hmr-user-"));
    const isolatedBoot = await createPluginBoot({
      kernelPath: paths.kernelPath,
      builtinRoot: paths.builtinRoot,
      userRoot: isolatedUserRoot,
      enableHmrWatcher: true,
      hmrWatcherFactory: factory,
    });
    try {
      await isolatedBoot.dispose();
      expect(factory).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllEnvs();
      rmSync(isolatedUserRoot, { recursive: true, force: true });
    }
  });

  it("tears down the root even when watcher disposal rejects", async () => {
    const isolatedUserRoot = mkdtempSync(path.join(tmpdir(), "ic-boot-hmr-reject-user-"));
    const disposeError = new Error("watcher dispose failed");
    const isolatedBoot = await createPluginBoot({
      kernelPath: paths.kernelPath,
      builtinRoot: paths.builtinRoot,
      userRoot: isolatedUserRoot,
      enableHmrWatcher: true,
      hmrWatcherFactory: () => ({
        watchPath: async () => async () => {},
        dispose: async () => { throw disposeError; },
      }),
    });
    await expect(isolatedBoot.dispose()).rejects.toBe(disposeError);
    expect(isolatedBoot.root.fiber.getEffects()).toEqual([]);
    rmSync(isolatedUserRoot, { recursive: true, force: true });
  });

  it("keeps dynamic root and session timers isolated across disposal", async () => {
    const isolatedUserRoot = mkdtempSync(path.join(tmpdir(), "ic-boot-timer-user-"));
    const isolatedBoot = await createPluginBoot({
      kernelPath: paths.kernelPath,
      builtinRoot: paths.builtinRoot,
      userRoot: isolatedUserRoot,
      workspaceRoot: process.cwd(),
    });
    const rootTimer = isolatedBoot.root.timer;
    rootTimer.setInterval(() => {}, 60_000);
    const scope = isolatedBoot.createSessionScope();
    const session = await AgentSession.create({
      scope,
      spine: isolatedBoot.spine,
      plugins: [],
      provider: createMockProvider({ turns: [{ text: "ok" }] }),
      workspaceRoot: process.cwd(),
      permission: {
        mode: "auto",
        decider: { ask: async () => "deny" },
      },
    });
    scope.ctx.timer.setInterval(() => {}, 60_000);
    const timerFibers = isolatedBoot.root.registry.get(isolatedBoot.spine.timer.TimerPlugin)?.fibers ?? [];
    const sessionTimerFiber = timerFibers.find(({ parent }) => parent === scope.ctx.fiber);
    expect(rootTimer).toBeDefined();
    expect(scope.ctx.timer).not.toBe(rootTimer);
    expect(isolatedBoot.spine.timer.TimerPlugin).toBeDefined();
    expect(isolatedBoot.root.fiber.getEffects().some(({ label }) => label === "plugin(kernel-timer)"))
      .toBe(true);
    expect(sessionTimerFiber?.getEffects().filter(({ label }) => label.startsWith("timer "))).toHaveLength(1);

    await session.dispose();
    expect(sessionTimerFiber?.getEffects().filter(({ label }) => label.startsWith("timer "))).toHaveLength(0);
    expect(scope.ctx.timer).toBe(rootTimer);
    expect(isolatedBoot.root.fiber.getEffects().some(({ label }) => label === "plugin(kernel-timer)"))
      .toBe(true);

    expect(isolatedBoot.root.timer).toBe(rootTimer);
    await isolatedBoot.dispose();
    expect(isolatedBoot.root.fiber.getEffects()).toEqual([]);
    await scope.dispose();
    rmSync(isolatedUserRoot, { recursive: true, force: true });
  });

  it("boots a full session inside a route scope with disk-loaded fs/shell", async () => {
    const b = await ensureBoot();
    const fsPlugin = (await b.importPlugin("fs")) as SessionPlugin;
    const shellPlugin = (await b.importPlugin("shell")) as SessionPlugin;
    expect(fsPlugin.name).toBe("fs");
    expect(shellPlugin.name).toBe("shell");

    const scope = b.createSessionScope();
    let scopeCleaned = 0;
    scope.ctx.effect(() => () => { scopeCleaned += 1; }, "scope-probe");

    const session = await AgentSession.create({
      scope,
      // Production parity: the session mounts the SAME spine suite the boot
      // loaded from the staging tree (the runtime's sessionSpine hook).
      spine: b.spine,
      plugins: [fsPlugin, shellPlugin],
      provider: createMockProvider({ turns: [{ text: "ok" }] }),
      workspaceRoot: process.cwd(),
      permission: {
        mode: "auto",
        decider: { ask: async () => "deny" },
      },
    });
    const tools = [...session.registry.tools.keys()].sort();
    expect(tools).toContain("Bash");
    expect(tools).toContain("Read");
    // The session shadowed the boot root's spine names inside its scope.
    expect(scope.ctx.services.owns("tools")).toBe(true);

    const summary = await session.run("装载链探针");
    expect(summary.finalText).toBe("ok");
    await session.dispose();
    expect(scopeCleaned).toBe(1);
    expect(scope.ctx.fiber.state).toBe(b.kernel.FiberState.DISPOSED);
    // The boot root survives the route scope teardown.
    expect(b.root.fiber.state).toBe(b.kernel.FiberState.ACTIVE);
  });

  // ---- T2 声明式装载收敛 --------------------------------------------------

  it("resolveBuiltinSet drives from entries: toggles become disabled entries", async () => {
    const b = await ensureBoot();
    const resolved = await b.resolveBuiltinSet({
      workspaceRoot: process.cwd(),
      userToggles: { mcp: false },
    });
    expect(resolved.active).not.toContain("mcp");
    const mcpEntry = resolved.entries.find((e) => e.id === "mcp");
    expect(mcpEntry).toMatchObject({ name: "mcp", disabled: true });
    expect(resolved.entries.find((e) => e.id === "fs")).toMatchObject({ disabled: false });
  });

  it("mountEntries mounts active rows and short-circuits disabled ones (entries() visible)", async () => {
    const b = await ensureBoot();
    const resolved = await b.resolveBuiltinSet({
      workspaceRoot: process.cwd(),
      userToggles: { todo: false },
    });
    const { failures } = await b.mountEntries(resolved.entries, () => {});
    // todo was disabled: it produced a loader entry that short-circuited
    // (never imported, never mounted — and never in the failures list).
    expect(failures).not.toContain("todo");
    // entries() face: disabled rows are visible in the loader tree.
    expect(b.loaderEntryIds()).toContain("boot-todo");
    // fs mounted through the full disk chain (its tools registered).
    expect(b.root.tools.specs().map((s) => s.name)).toContain("Read");
  });

  it("user-level cordis.yml disables mcp across the whole chain (session has no mcp plugin)", async () => {
    const home = mkdtempSync(path.join(tmpdir(), "ic-cordis-home-"));
    roots.push(home);
    mkdirSync(path.join(home, ".innocence"), { recursive: true });
    writeFileSync(path.join(home, ".innocence", "cordis.yml"), "plugins:\n  mcp: false\n", "utf8");
    const previousHome = process.env.USERPROFILE ?? process.env.HOME;
    // os.homedir() on Windows follows USERPROFILE; keep the override scoped.
    process.env.USERPROFILE = home;
    process.env.HOME = home;
    try {
      const composition = createSessionComposition({
        resolvePaths: () => paths,
        getWorkspaceRoot: () => undefined,
        log: () => {},
      });
      const ws = mkdtempSync(path.join(tmpdir(), "ic-cordis-ws-"));
      roots.push(ws);
      const names = (await composition.composePlugins(ws)).map((p) => p.name);
      expect(names).not.toContain("mcp");
      expect(names).toContain("fs");
      expect(names).toContain("todo");
      await composition.disposePluginBoot();
    } finally {
      if (previousHome === undefined) {
        delete process.env.USERPROFILE;
        delete process.env.HOME;
      } else {
        process.env.USERPROFILE = previousHome;
        process.env.HOME = previousHome;
      }
    }
  });

  it("example 开关端到端：settings 关 example（normalize 保留）→ inventory disabled → 条目 disabled 短路", async () => {
    const b = await ensureBoot();
    // 写路径等价面：settings normalize 开放键空间，example:false 不再被剔除。
    const { mergeSettings } = await import("@innocenceharness/harness-electron");
    const settings = mergeSettings({ profiles: [], pluginToggles: { example: false } });
    expect(settings.pluginToggles).toEqual({ example: false });
    // 清单投影：example 条目 toggleable:true 且呈 disabled-by-config（user 层）。
    // webview 侧装载消费同一 state 过滤（loader.test：非 active 不装载 client）。
    const inventory = await b.pluginInventory({
      workspaceRoot: process.cwd(),
      userToggles: settings.pluginToggles,
    });
    const example = inventory.find((entry) => entry.id === "example");
    expect(example).toMatchObject({ core: false, toggleable: true, state: "disabled-by-config", via: "user" });
    // 装载面：disabled 条目短路（loader.startEntry 对 disabled 不导入不挂载；
    // 同款短路断言见 mountEntries 用例），此处钉死条目面 disabled 显式值。
    const resolved = await b.resolveBuiltinSet({
      workspaceRoot: process.cwd(),
      userToggles: settings.pluginToggles,
    });
    expect(resolved.active).not.toContain("example");
    expect(resolved.entries.find((e) => e.id === "example")).toMatchObject({ disabled: true });
  });

  it("manifest 键空间派生：example 进入 knownKeys（yml example:false 生效）；旧 yml 未知键仍告警忽略", async () => {
    const b = await ensureBoot();
    const resolved = await b.resolveBuiltinSet({ workspaceRoot: process.cwd() });
    expect(resolved.active).toContain("example");
    // 项目 yml 键空间 = 清单 id 集：example 可写、清单外键告警。
    const warnings: string[] = [];
    const ws = mkdtempSync(path.join(tmpdir(), "ic-keyspace-ws-"));
    roots.push(ws);
    mkdirSync(path.join(ws, ".innocence"), { recursive: true });
    writeFileSync(
      path.join(ws, ".innocence", "plugins.yml"),
      "plugins:\n  example: false\n  mystery: true\n",
      "utf8",
    );
    const projectResolved = await b.resolveBuiltinSet({
      workspaceRoot: ws,
      logger: (level, msg) => {
        if (level === "warn") warnings.push(String(msg));
      },
    });
    expect(projectResolved.active).not.toContain("example");
    expect(warnings.join("\n")).toContain('unknown plugin toggle "mystery"');
  });

  it("single instance: a staging plugin's KernelError passes the host-side instanceof", async () => {
    const b = await ensureBoot();
    // Fixture plugin below the boot's user root: its apply throws the STAGING
    // kernel's KernelError (imported by absolute file URL — the same module
    // loadKernel returned), so the identity check below is meaningful only
    // when plugin and host share ONE kernel module instance.
    const fixtureRoot = userRoot!;
    const fixtureDir = path.join(fixtureRoot, "kernel-error-fixture", "dist");
    mkdirSync(fixtureDir, { recursive: true });
    writeFileSync(
      path.join(fixtureDir, "index.js"),
      [
        `import { KernelError } from ${JSON.stringify(pathToFileURL(paths.kernelPath).href)};`,
        `export default {`,
        `  name: "kernel-error-fixture",`,
        `  async apply() {`,
        `    throw new KernelError("DUPLICATE_SERVICE", "fixture probe");`,
        `  },`,
        `};`,
        "",
      ].join("\n"),
      "utf8",
    );

    let thrown: unknown;
    try {
      await b.mountAtRoot("kernel-error-fixture");
    } catch (error) {
      thrown = error;
    }
    // The loader surfaces the plugin's failure as its wrapped error's cause.
    const wrapped = thrown as { message?: string; cause?: unknown };
    expect(thrown).toBeInstanceOf(Error);
    expect(wrapped.message).toContain("failed to start loader entry");
    // The host side checks the class THROUGH loadKernel's module: true only
    // when the fixture resolved the same kernel module instance.
    expect(wrapped.cause).toBeInstanceOf(b.kernel.KernelError);
    expect((wrapped.cause as { code?: string }).code).toBe("DUPLICATE_SERVICE");
  });

  it("single instance: the boot spine and the staged spine modules are one and the same", async () => {
    const b = await ensureBoot();
    const staged = path.join(
      path.dirname(paths.kernelPath), "..", "..", "harness-tools", "dist", "index.js",
    );
    const stagedTools = (await import(pathToFileURL(staged).href)) as typeof import("@innocenceharness/harness-tools");
    // Module-object identity: the suite the host mounts IS the module the
    // staging tree serves to disk-loaded plugins (no second spine copy).
    expect(b.spine.tools.ToolsPlugin).toBe(stagedTools.ToolsPlugin);
    expect(b.spine.tools.createExecutionScope).toBe(stagedTools.createExecutionScope);
    const loggerEntry = path.join(
      path.dirname(paths.kernelPath), "..", "..", "kernel-logger", "dist", "index.js",
    );
    const stagedLogger = (await import(pathToFileURL(loggerEntry).href)) as typeof import("@innocenceharness/kernel-logger");
    expect(b.spine.logger.LoggerPlugin).toBe(stagedLogger.LoggerPlugin);
    // And the boot's mount face really registers through that staged spine.
    expect(b.root.tools.specs().length).toBeGreaterThan(0);
  });

  it("retry seam: failed loads are not memoized (kernelLoader + session composition)", async () => {
    // kernelLoader: a failed dynamic import must not poison the process memo.
    const missing = path.join(tmpdir(), "ic-missing-kernel", "dist", "index.js");
    resetKernelCache();
    await expect(loadKernel(missing)).rejects.toThrow();
    const kernel = await loadKernel(paths.kernelPath);
    expect(typeof kernel.createScope).toBe("function");
    expect(await loadKernel(paths.kernelPath)).toBe(kernel);

    // Session composition: a failed boot (unreadable manifest) clears the
    // memo, so the next composition attempt retries instead of replaying the
    // rejection; a subsequent good attempt succeeds.
    let attempt = 0;
    const composition = createSessionComposition({
      resolvePaths: () =>
        attempt++ === 0
          ? { kernelPath: paths.kernelPath, builtinRoot: path.join(tmpdir(), "ic-missing-plugins") }
          : { kernelPath: paths.kernelPath, builtinRoot: paths.builtinRoot },
      getWorkspaceRoot: () => undefined,
      log: () => {},
    });
    await expect(composition.ensureBoot()).rejects.toThrow(/manifest/);
    const retry = await composition.ensureBoot();
    expect(retry.kernel).toBe(kernel);
    await composition.disposePluginBoot();
  });
});

if (!stagingAvailable) {
  it.skip("staging tree not found — run `npm run build:plugins` then re-run to exercise the boot chain", () => {});
}
