// 系统托盘与「关闭到托盘」（仅 Windows）：启用时实时创建 Tray、禁用即销毁；
// 主窗口 close 事件在启用且非退出流程时拦截为隐藏。其他平台永不建托盘、
// 关闭行为不变。主窗口访问口注入（initTray）以避免与 appWindow 的循环依赖。
import { app, Menu, nativeImage, Tray, type BrowserWindow } from "electron";
import { resolveAssetIcon } from "./appWindow";
import { logger } from "./logger";

/** 托盘菜单标签（zh 优先，集中一处）。 */
export const TRAY_LABELS = {
  showWindow: "显示窗口",
  quit: "退出",
} as const;

/** 关闭到托盘判定（纯函数）：仅 Windows、已启用、非退出流程中三者同时成立。 */
export function shouldCloseToTray(input: {
  enabled: boolean;
  quitting: boolean;
  platform: string;
}): boolean {
  return input.enabled && !input.quitting && input.platform === "win32";
}

let tray: Tray | undefined;
let enabled = false;
let quitting = false;
let getWindow: () => BrowserWindow | undefined = () => undefined;

/** 注入主窗口访问口；启动时调用一次（测试可换假窗口）。 */
export function initTray(deps: { getWindow: () => BrowserWindow | undefined }): void {
  getWindow = deps.getWindow;
}

function showMainWindow(): void {
  const win = getWindow();
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function createTray(): Tray {
  const iconPath = resolveAssetIcon("icon-16.png") ?? resolveAssetIcon("icon.png");
  const image = iconPath ? nativeImage.createFromPath(iconPath) : nativeImage.createEmpty();
  const instance = new Tray(image);
  instance.setToolTip(app.getName());
  instance.setContextMenu(
    Menu.buildFromTemplate([
      { label: TRAY_LABELS.showWindow, click: showMainWindow },
      { type: "separator" },
      {
        label: TRAY_LABELS.quit,
        click: () => {
          // 退出标记必须先置位：随后的 app.quit() 触发的窗口 close 不再被
          // 拦截为隐藏。
          quitting = true;
          app.quit();
        },
      },
    ]),
  );
  instance.on("click", showMainWindow);
  return instance;
}

/** 开关实时生效（设置提交后/启动时调用）：启用即建、禁用即毁；幂等。 */
export function applyCloseToTray(next: boolean): void {
  enabled = next;
  if (shouldCloseToTray({ enabled, quitting, platform: process.platform })) {
    if (!tray) {
      try {
        tray = createTray();
      } catch (error) {
        logger.warn("tray create failed", { error: String(error) });
      }
    }
  } else if (tray) {
    tray.destroy();
    tray = undefined;
  }
}

/**
 * 主窗口 close 拦截：命中关闭到托盘时 preventDefault + 隐藏并返回 true；
 * 否则返回 false（调用方走正常关闭流程）。
 */
export function handleMainWindowClose(event: { preventDefault(): void }, win: BrowserWindow): boolean {
  if (!shouldCloseToTray({ enabled, quitting, platform: process.platform })) return false;
  event.preventDefault();
  win.hide();
  return true;
}

/** 退出流程标记（before-quit）：之后的 close 不再拦截，托盘随退出销毁。 */
export function markTrayQuitting(): void {
  quitting = true;
  applyCloseToTray(enabled);
}

/** 显式资源释放（关机/测试路径）：销毁托盘并复位全部模块状态。 */
export function disposeTray(): void {
  tray?.destroy();
  tray = undefined;
  enabled = false;
  quitting = false;
  getWindow = () => undefined;
}
