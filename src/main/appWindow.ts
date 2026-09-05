// Main window creation:
// - show on 'ready-to-show' to avoid a white flash
// - sandbox + contextIsolation preloads
// - renderer served from the custom innocenceharness:// scheme in production,
//   vite dev server during development
import { app, BrowserWindow, screen } from "electron";
import fs from "node:fs";
import path from "node:path";
import { APP_SCHEME, appIndexUrl } from "./protocol";
import { logger } from "./logger";
import { appDataRootOrNull } from "./appDataRoot";
import { getTheme } from "./theme";
import { handleMainWindowClose } from "./tray";
import { IPC } from "../shared/ipc";
import { BROWSER_PARTITION } from "../shared/browserIpc";
import { isBrowserEnabled } from "./browserSession";
import {
  fitWindowStateToDisplays,
  loadWindowState,
  saveWindowState,
  windowStateFile,
} from "./windowState";

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

/**
 * 应用图标资源解析：dev 取仓库 assets/（stock 运行时的默认 shell 图标会泄
 * 漏到任务栏/托盘），打包取 resources/assets（assets/ 经 extraResource 随包
 * 发布）；候选都不存在 → undefined（调用方省略图标）。
 */
export function resolveAssetIcon(fileName: string): string | undefined {
  const candidates = [
    path.join(__dirname, "..", "..", "assets", fileName), // dev: repo assets/
  ];
  // process.resourcesPath 仅 Electron 运行时存在（Node 测试环境为 undefined）。
  if (typeof process.resourcesPath === "string" && process.resourcesPath !== "") {
    candidates.push(path.join(process.resourcesPath, "assets", fileName)); // packaged: resources/assets
  }
  return candidates.find((candidate) => {
    try {
      return fs.existsSync(candidate);
    } catch {
      return false;
    }
  });
}

export async function createMainWindow(onRendererReady?: () => void): Promise<BrowserWindow> {
  const resolved = getTheme().resolved;

  // 窗口图标走统一的资源解析（dev 仓库 assets/，打包 resources/assets；
  // 打包 Windows 构建的 exe 自带图标，此候选主要覆盖 dev 与非 Windows 打包）。
  const iconPath = resolveAssetIcon("icon.png");

  // 恢复上次关闭时的窗口几何：存档缺失/损坏/离屏（显示器拔掉）时回退默认。
  // 窗口状态存档属应用数据（应用数据根，与 Electron 缓存的默认 userData
  // 分离），路径按规则惰性解析，绝不在模块装载时取。
  const stateRoot = appDataRootOrNull();
  const stateFile = stateRoot ? windowStateFile(stateRoot) : null;
  const restored = stateFile
    ? fitWindowStateToDisplays(
        loadWindowState(stateFile) ?? { width: 1280, height: 800, maximized: false },
        screen.getAllDisplays().map((display) => display.workArea),
      )
    : { width: 1280, height: 800, maximized: false };

  const win = new BrowserWindow({
    width: restored.width,
    height: restored.height,
    ...(restored.x !== undefined && restored.y !== undefined ? { x: restored.x, y: restored.y } : {}),
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

  win.once("ready-to-show", () => {
    win.show();
    if (restored.maximized) win.maximize();
  });

  win.webContents.on("will-attach-webview", (event, preferences, params) => {
    if (!isBrowserEnabled() || params.partition !== BROWSER_PARTITION) {
      event.preventDefault();
      return;
    }
    delete preferences.preload;
    preferences.nodeIntegration = false;
    preferences.contextIsolation = true;
    preferences.sandbox = true;
  });

  // 窗口几何持久化：普通态尺寸/位置在拖动调整时去抖存档，最大化标志即时
  // 更新，关闭瞬间同步终写——任何时候杀掉进程都不丢最近状态。
  const persistGeometry = () => {
    if (!stateFile || win.isDestroyed()) return;
    const bounds = win.getNormalBounds();
    saveWindowState(stateFile, {
      width: bounds.width,
      height: bounds.height,
      x: bounds.x,
      y: bounds.y,
      maximized: win.isMaximized(),
    });
  };
  let geometryTimer: ReturnType<typeof setTimeout> | undefined;
  const persistGeometryDebounced = () => {
    if (geometryTimer) clearTimeout(geometryTimer);
    geometryTimer = setTimeout(() => {
      geometryTimer = undefined;
      if (win.isDestroyed() || win.isMaximized() || win.isMinimized()) return;
      persistGeometry();
    }, 400);
  };
  win.on("resize", persistGeometryDebounced);
  win.on("move", persistGeometryDebounced);
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
    if (geometryTimer) {
      clearTimeout(geometryTimer);
      geometryTimer = undefined;
    }
    persistGeometry();
    if (!win.isDestroyed()) win.webContents.send(IPC.windowMaximizedChanged, true);
  });
  win.on("unmaximize", () => {
    persistGeometry();
    if (!win.isDestroyed()) win.webContents.send(IPC.windowMaximizedChanged, false);
  });

  mainWindow = win;
  win.on("close", (event) => {
    if (geometryTimer) {
      clearTimeout(geometryTimer);
      geometryTimer = undefined;
    }
    persistGeometry();
    // 关闭到托盘（仅 Windows 且设置开启、非退出流程）：拦截关闭转为隐藏。
    handleMainWindowClose(event, win);
  });
  win.on("closed", () => {
    if (mainWindow === win) mainWindow = undefined;
  });
  if (loadCompleted && rendererReady && onRendererReady) {
    await rendererReady;
    onRendererReady();
  }
  return win;
}
