// Main window creation:
// - show on 'ready-to-show' to avoid a white flash
// - sandbox + contextIsolation preloads
// - renderer served from the custom innocenceharness:// scheme in production,
//   vite dev server during development
import { app, BrowserWindow } from "electron";
import fs from "node:fs";
import path from "node:path";
import { APP_SCHEME, appIndexUrl } from "./protocol";
import { logger } from "./logger";
import { getTheme } from "./theme";
import { IPC } from "../shared/ipc";

let mainWindow: BrowserWindow | undefined;

export function isAllowedNavigationUrl(url: string, devServerUrl: string | undefined): boolean {
  try {
    const candidate = new URL(url);
    if (candidate.protocol === `${APP_SCHEME}:` && candidate.hostname === "app") return true;
    if (devServerUrl === undefined) return false;
    return candidate.origin === new URL(devServerUrl).origin;
  } catch {
    return false;
  }
}

export function getMainWindow(): BrowserWindow | undefined {
  return mainWindow;
}

export async function createMainWindow(onRendererReady?: () => void): Promise<BrowserWindow> {
  const resolved = getTheme().resolved;

  // Dev runs under the stock Electron executable, whose default shell icon
  // would leak into the taskbar — point the window at our own icon. Packaged
  // Windows builds already carry the icon in the exe; the resources-path
  // candidate covers non-Windows packaged builds (assets/ ships via
  // extraResource).
  const iconPath = [
    path.join(__dirname, "..", "..", "assets", "icon.png"), // dev: repo assets/
    path.join(process.resourcesPath, "assets", "icon.png"), // packaged: resources/assets
  ].find((candidate) => {
    try {
      return fs.existsSync(candidate);
    } catch {
      return false;
    }
  });

  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 760,
    minHeight: 520,
    show: false,
    // 窗口底色 = 页面灰（侧栏色）；黑主区由网页层圆角浮起。
    backgroundColor: resolved === "dark" ? "#1e1e1e" : "#ececee",
    ...(iconPath ? { icon: iconPath } : {}),
    // 自绘窗口控制：Win/Linux 无边框 + 网页内控制钮（TitleBar 渲染，
    // window:* IPC 驱动）；macOS 保留系统红绿灯（hiddenInset）。
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "hidden",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      // dock 浏览器标签需要 <webview> 内嵌访客页面（访客独立进程，主窗口
      // 仍 sandbox + contextIsolation，不开 nodeIntegration）。
      webviewTag: true,
      spellcheck: true,
    },
  });

  win.once("ready-to-show", () => win.show());
  let rendererReady: Promise<void> | undefined;
  if (onRendererReady) {
    rendererReady = new Promise((resolve) => {
      win.webContents.once("did-finish-load", resolve);
    });
  }

  // MAIN_WINDOW_VITE_DEV_SERVER_URL is a build-time constant injected by
  // @electron-forge/plugin-vite (see vite-env.d.ts) — NOT process.env. It is
  // the dev server URL under `electron-forge start`, and statically replaced
  // with `undefined` in production builds, so packaged builds always take
  // the innocenceharness:// branch below.
  const devServerUrl = MAIN_WINDOW_VITE_DEV_SERVER_URL;
  // Optional load verification hook: set InnocenceHarness_SMOKE_OUT=<path> and the app
  // writes the load outcome there and exits (used by tools/smoke-test.cjs).
  const smokeOut = process.env.InnocenceHarness_SMOKE_OUT;
  let loadCompleted = false;
  try {
    if (devServerUrl) {
      await win.loadURL(devServerUrl);
    } else {
      await win.loadURL(appIndexUrl());
    }
    loadCompleted = true;
    if (smokeOut) {
      // loadURL resolves even for a 404 response body from our own protocol
      // handler, so verify actual rendered content, not just the promise.
      const title = win.webContents.getTitle();
      const bodyText: string = await win.webContents.executeJavaScript(
        "document.body.innerText.slice(0, 200)",
      );
      const failed = /not found/i.test(bodyText) || bodyText.trim() === "";
      fs.writeFileSync(smokeOut, failed ? `fail body="${bodyText}"` : `ok title="${title}"`);
      app.quit();
    }
  } catch (err) {
    logger.error("renderer failed to load", {
      via: devServerUrl ? "dev-server" : "app-scheme",
      error: String(err),
    });
    if (smokeOut) {
      fs.writeFileSync(smokeOut, `fail ${String(err)}`);
      app.quit();
    }
  }

  // Block any navigation away from our own origins.
  win.webContents.on("will-navigate", (event, url) => {
    if (!isAllowedNavigationUrl(url, devServerUrl)) event.preventDefault();
  });
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));

  // 自绘控制钮需要最大化状态同步（TitleBar 的还原图标切换）。
  win.on("maximize", () => {
    if (!win.isDestroyed()) win.webContents.send(IPC.windowMaximizedChanged, true);
  });
  win.on("unmaximize", () => {
    if (!win.isDestroyed()) win.webContents.send(IPC.windowMaximizedChanged, false);
  });

  mainWindow = win;
  win.on("closed", () => {
    if (mainWindow === win) mainWindow = undefined;
  });
  if (loadCompleted && rendererReady && onRendererReady) {
    await rendererReady;
    onRendererReady();
  }
  return win;
}
