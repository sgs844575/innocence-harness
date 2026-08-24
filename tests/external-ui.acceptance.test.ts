import { execFile, spawn } from "node:child_process";
import { createServer, Socket } from "node:net";
import fs from "node:fs/promises";
import { existsSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

type DesktopChild = ReturnType<typeof spawn>;

type DesktopRuntime = {
  entry: string;
  packaged: boolean;
};

type LaunchState = {
  child?: DesktopChild;
  devtools?: DevToolsConnection;
  output: string;
};

const require = createRequire(import.meta.url);
const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixtureDir = path.join(repoRoot, "tests", "fixtures", "external-ui-plugin");
const mainEntry = path.join(repoRoot, ".vite", "build", "main.js");
const stagingRoot = path.join(repoRoot, "build", "dist", "resources");
const stagedPluginRoot = path.join(stagingRoot, "plugins");
const packagedRuntimeDir = process.env.INNOCENCEHARNESS_TEST_EXTERNAL_UI_PACKAGE_DIR
  ? path.resolve(process.env.INNOCENCEHARNESS_TEST_EXTERNAL_UI_PACKAGE_DIR)
  : path.join(repoRoot, "out", "InnocenceHarness-win32-x64");
const packagedRuntimeEntry = path.join(packagedRuntimeDir, process.platform === "win32" ? "InnocenceHarness.exe" : "InnocenceHarness");
const children: DesktopChild[] = [];
const tempRoots: string[] = [];

function desktopRuntimeExecutable(): string | undefined {
  if (process.env.INNOCENCEHARNESS_TEST_EXTERNAL_UI_DISABLE_RUNTIME === "1") return undefined;
  try {
    const packageDir = path.dirname(require.resolve("electron/package.json"));
    const executable = path.join(packageDir, "dist", process.platform === "win32" ? "electron.exe" : "electron");
    return existsSync(executable) ? executable : undefined;
  } catch {
    return undefined;
  }
}

function desktopRuntime(): DesktopRuntime | undefined {
  if (process.env.INNOCENCEHARNESS_TEST_EXTERNAL_UI_DISABLE_RUNTIME === "1") return undefined;
  const devEntry = desktopRuntimeExecutable();
  if (devEntry !== undefined) return { entry: devEntry, packaged: false };
  try {
    if (existsSync(packagedRuntimeEntry) && statSync(packagedRuntimeEntry).isFile()) {
      return { entry: packagedRuntimeEntry, packaged: true };
    }
  } catch {
    // A disappearing or unreadable packaged executable is a diagnostic skip,
    // not a module-collection failure.
  }
  return undefined;
}

const runtime = desktopRuntime();
const runtimeReason = runtime === undefined
  ? `desktop runtime unavailable: Electron development binary or packaged executable not found (${packagedRuntimeEntry})`
  : undefined;

function hasGraphics(): boolean {
  if (process.platform === "win32" || process.platform === "darwin") return true;
  return Boolean(process.env.DISPLAY || process.env.WAYLAND_DISPLAY);
}

function waitForChildStart(child: DesktopChild, launchState: LaunchState): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const onSpawn = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    };
    const onError = (error: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error(`Electron child failed to start: ${String(error)}\nDesktop diagnostics:\n${launchState.output}`));
    };
    const cleanup = () => {
      child.off("spawn", onSpawn);
      child.off("error", onError);
    };
    child.once("spawn", onSpawn);
    child.once("error", onError);
  });
}

async function tempDir(prefix: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempRoots.push(dir);
  return dir;
}

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : 0;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  if (port === 0) throw new Error("unable to reserve a debugging port");
  return port;
}

async function waitForHttp(url: string, timeoutMs: number): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  let lastError = "";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return await response.text();
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`timed out waiting for ${url}: ${lastError}`);
}

class DevToolsConnection {
  private readonly socket: Socket;
  private buffer = Buffer.alloc(0);
  private readonly pending = new Map<number, (value: unknown) => void>();
  private nextId = 1;

  private constructor(socket: Socket) {
    this.socket = socket;
    socket.on("data", (chunk) => {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      this.drain();
    });
  }

  static async connect(endpoint: { host: string; port: number; path: string; timeoutMs?: number }): Promise<DevToolsConnection> {
    const timeoutMs = endpoint.timeoutMs ?? 10_000;
    const socket = await new Promise<Socket>((resolve, reject) => {
      const next = new Socket();
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        next.destroy();
        reject(new Error(`DevTools TCP connection timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      const cleanup = () => {
        clearTimeout(timer);
        next.off("error", onError);
        next.off("close", onClose);
        next.off("end", onEnd);
      };
      const onError = (error: Error) => {
        if (settled) return;
        settled = true;
        cleanup();
        next.destroy();
        reject(error);
      };
      const onClose = () => {
        if (settled) return;
        settled = true;
        cleanup();
        next.destroy();
        reject(new Error("DevTools TCP socket closed before connect"));
      };
      const onEnd = () => {
        if (settled) return;
        settled = true;
        cleanup();
        next.destroy();
        reject(new Error("DevTools TCP socket ended before connect"));
      };
      next.once("error", onError);
      next.once("close", onClose);
      next.once("end", onEnd);
      next.connect(endpoint.port, endpoint.host, () => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(next);
      });
    });
    try {
      const key = Buffer.from(`${Date.now()}-${Math.random()}`).toString("base64");
      socket.write(
        `GET ${endpoint.path} HTTP/1.1\r\nHost: ${endpoint.host}:${endpoint.port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`,
      );
      await readHttpUpgrade(socket, timeoutMs);
      return new DevToolsConnection(socket);
    } catch (error) {
      socket.destroy();
      throw error;
    }
  }

  async evaluate(expression: string): Promise<unknown> {
    const id = this.nextId++;
    const result = new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, resolve);
      setTimeout(() => {
        if (this.pending.delete(id)) reject(new Error(`DevTools evaluation timed out: ${expression}`));
      }, 10_000);
    });
    this.send({ id, method: "Runtime.evaluate", params: { expression, awaitPromise: true, returnByValue: true } });
    return result;
  }

  close(): void {
    this.socket.destroy();
  }

  private send(value: unknown): void {
    const payload = Buffer.from(JSON.stringify(value), "utf8");
    const mask = Buffer.from([0x13, 0x37, 0x42, 0x69]);
    const header = payload.length < 126 ? Buffer.alloc(2) : payload.length < 65_536 ? Buffer.alloc(4) : Buffer.alloc(10);
    header[0] = 0x81;
    if (payload.length < 126) header[1] = 0x80 | payload.length;
    else if (payload.length < 65_536) { header[1] = 0x80 | 126; header.writeUInt16BE(payload.length, 2); }
    else { header[1] = 0x80 | 127; header.writeBigUInt64BE(BigInt(payload.length), 2); }
    const masked = Buffer.from(payload);
    for (let i = 0; i < masked.length; i += 1) masked[i] ^= mask[i % 4];
    this.socket.write(Buffer.concat([header, mask, masked]));
  }

  private drain(): void {
    while (this.buffer.length >= 2) {
      const first = this.buffer[0];
      const second = this.buffer[1];
      let offset = 2;
      let length = second & 0x7f;
      if (length === 126) { if (this.buffer.length < 4) return; length = this.buffer.readUInt16BE(2); offset = 4; }
      else if (length === 127) { if (this.buffer.length < 10) return; length = Number(this.buffer.readBigUInt64BE(2)); offset = 10; }
      const masked = (second & 0x80) !== 0;
      const maskOffset = offset;
      if (masked) offset += 4;
      if (this.buffer.length < offset + length) return;
      let payload = Buffer.from(this.buffer.subarray(offset, offset + length));
      if (masked) {
        const key = Buffer.from(this.buffer.subarray(maskOffset, maskOffset + 4));
        for (let i = 0; i < payload.length; i += 1) payload[i] ^= key[i % 4];
      }
      this.buffer = this.buffer.subarray(offset + length);
      if ((first & 0x0f) !== 1) continue;
      const message = JSON.parse(payload.toString("utf8")) as { id?: number; result?: unknown };
      if (message.id === undefined) continue;
      const resolve = this.pending.get(message.id);
      if (!resolve) continue;
      this.pending.delete(message.id);
      const result = message.result as { exceptionDetails?: unknown; result?: { value?: unknown } } | undefined;
      if (result?.exceptionDetails !== undefined) resolve(Promise.reject(new Error(JSON.stringify(result.exceptionDetails))));
      else resolve(result?.result?.value);
    }
  }
}

async function readHttpUpgrade(socket: Socket, timeoutMs = 10_000): Promise<void> {
  let data = Buffer.alloc(0);
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      socket.destroy();
      reject(new Error(`DevTools websocket upgrade timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    const cleanup = () => {
      clearTimeout(timer);
      socket.off("data", onData);
      socket.off("error", onError);
      socket.off("close", onClose);
      socket.off("end", onEnd);
    };
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error !== undefined) {
        socket.destroy();
        reject(error);
      } else {
        resolve();
      }
    };
    const onData = (value: Buffer) => {
      data = Buffer.concat([data, value]);
      if (!data.includes(Buffer.from("\r\n\r\n"))) return;
      const response = data.toString("utf8");
      if (!response.startsWith("HTTP/1.1 101")) {
        finish(new Error(`DevTools websocket upgrade failed: ${response}`));
        return;
      }
      finish();
    };
    const onError = (error: Error) => finish(error);
    const onClose = () => finish(new Error("DevTools websocket socket closed before upgrade"));
    const onEnd = () => finish(new Error("DevTools websocket socket ended before upgrade"));
    socket.on("data", onData);
    socket.once("error", onError);
    socket.once("close", onClose);
    socket.once("end", onEnd);
  });
}

async function runFixtureBuild(userRoot: string): Promise<void> {
  await execFileAsync(process.execPath, [path.join(fixtureDir, "build.mjs"), userRoot], { cwd: repoRoot });
}

async function prepareRoots(userRoot: string, builtinRoot: string): Promise<void> {
  await fs.cp(stagedPluginRoot, builtinRoot, { recursive: true });
  const manifestPath = path.join(builtinRoot, "manifest.json");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8")) as { plugins: Array<Record<string, unknown>> };
  manifest.plugins.push({ id: "external-ui-fixture", dependencies: [], title: "External UI fixture", client: true, toggleable: true });
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await runFixtureBuild(userRoot);
}

async function launchApp(
  userRoot: string,
  builtinRoot: string,
  userData: string,
  port: number,
  launchState: LaunchState,
): Promise<DevToolsConnection> {
  if (runtime === undefined) throw new Error(runtimeReason);
  if (!runtime.packaged && !existsSync(mainEntry)) {
    throw new Error(`main build missing: ${mainEntry}; run the renderer/main build before acceptance`);
  }
  const args = [
    `--user-data-dir=${userData}`,
    `--remote-debugging-port=${port}`,
    ...(runtime.packaged ? ["--innocence-controlled-test"] : [mainEntry]),
  ];
  const child = spawn(runtime.entry, args, {
    cwd: repoRoot,
    env: {
      ...process.env,
      INNOCENCEHARNESS_TEST_USER_PLUGIN_ROOT: userRoot,
      INNOCENCEHARNESS_TEST_BUILTIN_PLUGIN_ROOT: builtinRoot,
      INNOCENCEHARNESS_TEST_USER_DATA: userData,
      INNOCENCEHARNESS_TEST_MODE: "1",
      ELECTRON_ENABLE_LOGGING: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  const childStarted = waitForChildStart(child, launchState);
  launchState.child = child;
  children.push(child);
  child.stdout?.setEncoding("utf8");
  child.stderr?.setEncoding("utf8");
  child.stdout?.on("data", (chunk: string) => { launchState.output += chunk; });
  child.stderr?.on("data", (chunk: string) => { launchState.output += chunk; });
  const childStartFailure = childStarted.then(
    () => new Promise<never>(() => {}),
    (error: Error) => Promise.reject(error),
  );

  try {
    const list = JSON.parse(await Promise.race([
      waitForHttp(`http://127.0.0.1:${port}/json/list`, 30_000),
      childStartFailure,
    ])) as Array<{ type: string; webSocketDebuggerUrl?: string }>;
    const page = list.find((entry) => entry.type === "page" && entry.webSocketDebuggerUrl);
    if (!page?.webSocketDebuggerUrl) throw new Error("renderer page target missing");
    const target = new URL(page.webSocketDebuggerUrl);
    launchState.devtools = await DevToolsConnection.connect({ host: target.hostname, port: Number(target.port), path: target.pathname });
    return launchState.devtools;
  } catch (error) {
    throw new Error(`${String(error)}\nDesktop diagnostics:\n${launchState.output}`);
  }
}

async function clickButton(devtools: DevToolsConnection, matcher: string): Promise<void> {
  const expression = `(() => { const re = new RegExp(${JSON.stringify(matcher)}, 'i'); const button = [...document.querySelectorAll('button')].find((node) => re.test(node.getAttribute('aria-label') || '') || re.test(node.textContent || '')); if (!button) throw new Error('button not found: ' + ${JSON.stringify(matcher)}); button.click(); return true; })()`;
  await devtools.evaluate(expression);
}

async function waitForText(devtools: DevToolsConnection, text: string, timeoutMs = 20_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const body = String(await devtools.evaluate("document.body?.innerText ?? ''"));
    if (body.includes(text)) return;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  const body = String(await devtools.evaluate("document.body?.innerText ?? ''"));
  throw new Error(`timed out waiting for text ${JSON.stringify(text)}; body:\n${body}`);
}

async function waitForAbsent(devtools: DevToolsConnection, text: string, timeoutMs = 20_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const body = String(await devtools.evaluate("document.body?.innerText ?? ''"));
    if (!body.includes(text)) return;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  const body = String(await devtools.evaluate("document.body?.innerText ?? ''"));
  throw new Error(`timed out waiting for text to disappear ${JSON.stringify(text)}; body:\n${body}`);
}

async function terminateChild(child: DesktopChild): Promise<void> {
  if (child.exitCode !== null) return;
  if (process.platform === "win32" && child.pid !== undefined) {
    await execFileAsync("taskkill", ["/T", "/F", "/PID", String(child.pid)]).catch(() => undefined);
  } else {
    child.kill("SIGTERM");
  }
  await new Promise<void>((resolve) => {
    if (child.exitCode !== null) { resolve(); return; }
    child.once("exit", () => resolve());
    setTimeout(resolve, 5_000);
  });
}

async function cleanupLaunchState(launchState: LaunchState): Promise<void> {
  launchState.devtools?.close();
  launchState.devtools = undefined;
  if (launchState.child !== undefined) {
    await terminateChild(launchState.child);
    launchState.child = undefined;
  }
}

async function cleanupTempRoot(root: string): Promise<void> {
  await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  const index = tempRoots.indexOf(root);
  if (index >= 0) tempRoots.splice(index, 1);
}

afterEach(async () => {
  for (const child of children.splice(0)) await terminateChild(child);
  for (const root of tempRoots.splice(0)) await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

const graphicsAvailable = hasGraphics();
const acceptanceSkipReason = !graphicsAvailable
  ? "graphical environment unavailable (set DISPLAY/WAYLAND_DISPLAY for real desktop acceptance)"
  : runtimeReason;
const acceptanceIt = acceptanceSkipReason === undefined ? it : it.skip;
if (acceptanceSkipReason !== undefined) {
  console.warn(`[external-ui] SKIP: ${acceptanceSkipReason}`);
}

describe("external UI harness lifecycle", () => {
  it("wraps asynchronous child spawn errors with collected diagnostics", async () => {
    const launchState: LaunchState = { output: "fixture stdout\nfixture stderr" };
    const child = spawn(path.join(repoRoot, "missing-external-ui-runtime.exe"), [], {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    await expect(waitForChildStart(child, launchState)).rejects.toThrow(
      /Electron child failed to start:.*fixture stdout.*fixture stderr/s,
    );
    await terminateChild(child);
  });

  it("destroys a socket when the DevTools upgrade rejects", async () => {
    const sockets = new Set<Socket>();
    const server = createServer((socket) => {
      sockets.add(socket);
      socket.write("HTTP/1.1 503 Service Unavailable\r\nContent-Length: 0\r\n\r\n");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const address = server.address();
    if (typeof address !== "object" || address === null) throw new Error("test server did not bind");
    try {
      await expect(DevToolsConnection.connect({ host: "127.0.0.1", port: address.port, path: "/devtools", timeoutMs: 1_000 }))
        .rejects.toThrow(/upgrade|ended|closed/i);
    } finally {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

describe("external UI plugin real Electron acceptance", () => {
  acceptanceIt("loads panel/settings through innocenceharness-plugin and revokes both after disabling the fixture", async () => {
    const launchState: LaunchState = { output: "" };
    const roots: string[] = [];
    try {
      if (!existsSync(stagedPluginRoot)) throw new Error(`staging plugin root missing: ${stagedPluginRoot}`);
      const userRoot = await tempDir("ic-external-ui-user-");
      const builtinRoot = await tempDir("ic-external-ui-builtin-");
      const userData = await tempDir("ic-external-ui-data-");
      roots.push(userRoot, builtinRoot, userData);
      await prepareRoots(userRoot, builtinRoot);
      const port = await freePort();
      const devtools = await launchApp(userRoot, builtinRoot, userData, port, launchState);
      await waitForText(devtools, "InnocenceHarness");
      await clickButton(devtools, "auxiliary panel|辅助面板");
      await waitForText(devtools, "fixture.panel");
      await clickButton(devtools, "^fixture\\.panel$");
      await waitForText(devtools, "Fixture panel content");

      await clickButton(devtools, "^settings$|设置");
      await waitForText(devtools, "fixture.settings");
      await clickButton(devtools, "^fixture\\.settings$");
      await waitForText(devtools, "Fixture settings content");

      await clickButton(devtools, "^plugins$|插件");
      await waitForText(devtools, "External UI fixture");
      await clickButton(devtools, "External UI fixture");
      await waitForAbsent(devtools, "Fixture settings content");
      await waitForAbsent(devtools, "fixture.settings");

      await clickButton(devtools, "back to chat|返回会话");
      await clickButton(devtools, "auxiliary panel|辅助面板");
      await waitForAbsent(devtools, "fixture.panel");
      await waitForAbsent(devtools, "Fixture panel content");
    } catch (error) {
      throw new Error(`${String(error)}\nDesktop diagnostics:\n${launchState.output}`);
    } finally {
      await cleanupLaunchState(launchState);
      for (const root of roots) await cleanupTempRoot(root);
    }
  }, 90_000);
});
