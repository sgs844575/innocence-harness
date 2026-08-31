// Theme handling — the renderer mirrors nativeTheme through the
// electron-dark / electron-light root classes (see webview index.html).
import { BrowserWindow, nativeTheme } from "electron";
import { IPC, type ThemeMode } from "../shared/ipc";

let mode: ThemeMode = "system";

export function getTheme(): { mode: ThemeMode; resolved: "dark" | "light" } {
  return {
    mode,
    resolved: nativeTheme.shouldUseDarkColors ? "dark" : "light",
  };
}

export function setTheme(next: ThemeMode): void {
  mode = next;
  nativeTheme.themeSource = next;
}

export function broadcastTheme(win: BrowserWindow): void {
  const theme = getTheme();
  if (win.isDestroyed()) return;
  win.webContents.send(IPC.themeChanged, theme.mode, theme.resolved);
}

export function watchTheme(win: BrowserWindow): void {
  nativeTheme.on("updated", () => broadcastTheme(win));
}
