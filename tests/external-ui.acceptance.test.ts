import fs from "node:fs/promises";
import { existsSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterEach, describe, it } from "vitest";
import { _electron as desktopDriver } from "playwright-core";
import { selectExternalUiRuntime } from "./externalUiRuntime";

type DesktopApp = Awaited<ReturnType<typeof desktopDriver.launch>>;
type DesktopWindow = Awaited<ReturnType<DesktopApp["firstWindow"]>>;

const require = createRequire(import.meta.url);
const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixtureDir = path.join(repoRoot, "tests", "fixtures", "external-ui-plugin");
const mainEntry = path.join(repoRoot, ".vite", "build", "main.js");
const stagingRoot = path.join(repoRoot, "build", "dist", "resources");
const stagedPluginRoot = path.join(stagingRoot, "plugins");
const requestedPackagedRuntimeDir = process.env.INNOCENCEHARNESS_TEST_EXTERNAL_UI_PACKAGE_DIR;
const packagedRuntimeDir = requestedPackagedRuntimeDir
  ? path.resolve(requestedPackagedRuntimeDir)
  : path.join(repoRoot, "out", "InnocenceHarness-win32-x64");
const apps: DesktopApp[] = [];
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

const runtimeSelection = selectExternalUiRuntime({
  defaultPackageDirectory: packagedRuntimeDir,
  developmentEntry: desktopRuntimeExecutable(),
  executableName: process.platform === "win32" ? "InnocenceHarness.exe" : "InnocenceHarness",
  isExecutable: (entry) => {
    try {
      const details = statSync(entry);
      return details.isFile() && (process.platform === "win32" || (details.mode & 0o111) !== 0);
    } catch {
      return false;
    }
  },
  requestedPackageDirectory: requestedPackagedRuntimeDir ? packagedRuntimeDir : undefined,
  runtimeDisabled: process.env.INNOCENCEHARNESS_TEST_EXTERNAL_UI_DISABLE_RUNTIME === "1",
});
const runtime = runtimeSelection.status === "available" ? runtimeSelection.runtime : undefined;
const runtimeReason = runtimeSelection.status === "unavailable" ? runtimeSelection.reason : undefined;

function hasGraphics(): boolean {
  if (process.platform === "win32" || process.platform === "darwin") return true;
  return Boolean(process.env.DISPLAY || process.env.WAYLAND_DISPLAY);
}

async function tempDir(prefix: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempRoots.push(dir);
  return dir;
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

interface DesktopSession {
  app: DesktopApp;
  window: DesktopWindow;
}

/** Launches the real desktop runtime and returns the app plus its first
 *  window. Launch plumbing (process spawn, DevTools transport, evaluation)
 *  is owned by the desktop driver library, not by this suite. */
async function launchApp(userRoot: string, builtinRoot: string, userData: string): Promise<DesktopSession> {
  if (runtime === undefined) throw new Error(runtimeReason);
  if (!runtime.packaged && !existsSync(mainEntry)) {
    throw new Error(`main build missing: ${mainEntry}; run the renderer/main build before acceptance`);
  }
  const args = [
    `--user-data-dir=${userData}`,
    ...(runtime.packaged ? ["--innocence-controlled-test"] : [mainEntry]),
  ];
  console.info(
    `[external-ui] runtime source=${runtime.source} packaged=${runtime.packaged} controlledTest=${args.includes("--innocence-controlled-test")} entry=${runtime.entry}`,
  );
  const app = await desktopDriver.launch({
    executablePath: runtime.entry,
    args,
    cwd: repoRoot,
    env: {
      ...process.env,
      INNOCENCEHARNESS_TEST_USER_PLUGIN_ROOT: userRoot,
      INNOCENCEHARNESS_TEST_BUILTIN_PLUGIN_ROOT: builtinRoot,
      INNOCENCEHARNESS_TEST_USER_DATA: userData,
      INNOCENCEHARNESS_TEST_MODE: "1",
      ELECTRON_ENABLE_LOGGING: "1",
    } as Record<string, string>,
  });
  apps.push(app);
  const window = await app.firstWindow();
  return { app, window };
}

/** Waits until the page body contains text; on timeout the current body is
 *  attached to the error for diagnostics. */
async function waitForText(session: DesktopSession, text: string, timeoutMs = 20_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const body = await session.window.locator("body").innerText({ timeout: 5_000 }).catch(() => "");
    if (body.includes(text)) return;
    if (Date.now() >= deadline) {
      throw new Error(`timed out waiting for text ${JSON.stringify(text)}; body:\n${body}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
}

async function waitForAbsent(session: DesktopSession, text: string, timeoutMs = 20_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const body = await session.window.locator("body").innerText({ timeout: 5_000 }).catch(() => "");
    if (!body.includes(text)) return;
    if (Date.now() >= deadline) {
      throw new Error(`timed out waiting for text to disappear ${JSON.stringify(text)}; body:\n${body}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
}

/** Clicks/activates the first control whose accessible name matches the
 *  pattern. Workbench tabs declare role="tab", settings toggles role="switch";
 *  everything else is a plain button. */
async function clickButton(session: DesktopSession, matcher: string): Promise<void> {
  const name = new RegExp(matcher, "i");
  for (const role of ["tab", "button", "switch"] as const) {
    const control = session.window.getByRole(role, { name }).first();
    if ((await control.count()) > 0) {
      await control.click({ timeout: 10_000 });
      return;
    }
  }
  throw new Error(`no control matches ${matcher}`);
}

afterEach(async () => {
  for (const app of apps.splice(0)) {
    await app.close().catch(() => app.process().kill());
  }
  for (const root of tempRoots.splice(0)) {
    await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

const graphicsAvailable = hasGraphics();
const acceptanceSkipReason = !graphicsAvailable
  ? "graphical environment unavailable (set DISPLAY/WAYLAND_DISPLAY for real desktop acceptance)"
  : runtimeReason;
const acceptanceIt = acceptanceSkipReason === undefined ? it : it.skip;
if (acceptanceSkipReason !== undefined) {
  console.warn(`[external-ui] SKIP: ${acceptanceSkipReason}`);
}

describe("external UI plugin real Electron acceptance", () => {
  acceptanceIt("loads panel/settings through innocenceharness-plugin and revokes both after disabling the fixture", async () => {
    if (!existsSync(stagedPluginRoot)) throw new Error(`staging plugin root missing: ${stagedPluginRoot}`);
    const userRoot = await tempDir("ic-external-ui-user-");
    const builtinRoot = await tempDir("ic-external-ui-builtin-");
    const userData = await tempDir("ic-external-ui-data-");
    await prepareRoots(userRoot, builtinRoot);
    const session = await launchApp(userRoot, builtinRoot, userData);

    await waitForText(session, "InnocenceHarness");
    await clickButton(session, "auxiliary panel|辅助面板");
    await waitForText(session, "fixture-panel");
    await clickButton(session, "^fixture-panel$");
    await waitForText(session, "Fixture panel content");

    await clickButton(session, "^settings$|设置");
    await waitForText(session, "fixture.settings");
    await clickButton(session, "^fixture\\.settings$");
    await waitForText(session, "Fixture settings content");

    await clickButton(session, "^plugins$|插件");
    await waitForText(session, "External UI fixture");
    await clickButton(session, "External UI fixture");
    await waitForAbsent(session, "Fixture settings content");
    await waitForAbsent(session, "fixture.settings");

    await clickButton(session, "back to chat|返回会话");
    await clickButton(session, "auxiliary panel|辅助面板");
    await waitForAbsent(session, "fixture-panel");
    await waitForAbsent(session, "Fixture panel content");
  }, 90_000);
});
