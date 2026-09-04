// Window geometry persistence: remembers size/position/maximized across
// launches. Electron-free pure module — appWindow.ts wires BrowserWindow
// events and screen validation onto these primitives. Writes are atomic
// (tmp + rename) and best-effort, mirroring persistSessionIndex.
import fs from "node:fs";
import path from "node:path";

export interface WindowStateSnapshot {
  width: number;
  height: number;
  /** Normal (non-maximized) position; absent = let the OS center the window. */
  x?: number;
  y?: number;
  maximized: boolean;
}

/** Minimal display rectangle (Electron `Display.workArea` shape). */
export interface DisplayArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Smallest window the shell allows; restored sizes are clamped up to it. */
export const MIN_WINDOW_WIDTH = 760;
export const MIN_WINDOW_HEIGHT = 520;

/** <userData>/window-state.json */
export function windowStateFile(userDataDir: string): string {
  return path.join(userDataDir, "window-state.json");
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** Field-by-field validation; anything unexpected drops the whole snapshot. */
export function normalizeWindowState(raw: unknown): WindowStateSnapshot | null {
  if (typeof raw !== "object" || raw === null) return null;
  const candidate = raw as Record<string, unknown>;
  if (!isFiniteNumber(candidate.width) || candidate.width <= 0) return null;
  if (!isFiniteNumber(candidate.height) || candidate.height <= 0) return null;
  const state: WindowStateSnapshot = {
    width: Math.max(MIN_WINDOW_WIDTH, Math.round(candidate.width)),
    height: Math.max(MIN_WINDOW_HEIGHT, Math.round(candidate.height)),
    maximized: candidate.maximized === true,
  };
  // Position only counts as a pair — a lone coordinate is meaningless.
  if (isFiniteNumber(candidate.x) && isFiniteNumber(candidate.y)) {
    state.x = Math.round(candidate.x);
    state.y = Math.round(candidate.y);
  }
  return state;
}

/**
 * Drops the saved position when it no longer intersects any display (monitor
 * unplugged, resolution changed) so the window never resurrects off-screen.
 */
export function fitWindowStateToDisplays(
  state: WindowStateSnapshot,
  displays: readonly DisplayArea[],
): WindowStateSnapshot {
  if (state.x === undefined || state.y === undefined || displays.length === 0) {
    const { x: _x, y: _y, ...rest } = state;
    return rest;
  }
  const intersects = displays.some(
    (area) =>
      state.x! < area.x + area.width &&
      state.x! + state.width > area.x &&
      state.y! < area.y + area.height &&
      state.y! + state.height > area.y,
  );
  if (intersects) return state;
  const { x: _x, y: _y, ...rest } = state;
  return rest;
}

/** Defensive read: missing/corrupt/invalid content yields null, never throws. */
export function loadWindowState(file: string): WindowStateSnapshot | null {
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
  return normalizeWindowState(raw);
}

/** Atomic rewrite (tmp + rename); a lost write must never break window close. */
export function saveWindowState(file: string, state: WindowStateSnapshot): void {
  try {
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2), "utf8");
    fs.renameSync(tmp, file);
  } catch {
    // Geometry persistence is best-effort by design.
  }
}
