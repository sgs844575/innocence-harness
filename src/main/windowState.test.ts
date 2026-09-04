import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import {
  fitWindowStateToDisplays,
  loadWindowState,
  normalizeWindowState,
  saveWindowState,
  windowStateFile,
} from "./windowState";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "ic-window-state-"));
});

describe("normalizeWindowState", () => {
  it("round-trips a full snapshot", () => {
    expect(
      normalizeWindowState({ width: 1440, height: 900, x: 40, y: 60, maximized: false }),
    ).toEqual({ width: 1440, height: 900, x: 40, y: 60, maximized: false });
  });

  it("keeps a size-only snapshot (position absent)", () => {
    expect(normalizeWindowState({ width: 1280, height: 800 })).toEqual({
      width: 1280,
      height: 800,
      maximized: false,
    });
  });

  it("clamps undersized dimensions up to the window minimums", () => {
    expect(normalizeWindowState({ width: 300, height: 200 })).toEqual({
      width: 760,
      height: 520,
      maximized: false,
    });
  });

  it("drops a lone coordinate — position only counts as a pair", () => {
    expect(normalizeWindowState({ width: 1280, height: 800, x: 100 })).toEqual({
      width: 1280,
      height: 800,
      maximized: false,
    });
  });

  it.each([
    null,
    "bounds",
    { width: -5, height: 800 },
    { width: 1280, height: "800" },
    { width: Number.NaN, height: 800 },
  ])("rejects invalid input %j", (raw) => {
    expect(normalizeWindowState(raw)).toBeNull();
  });

  it("treats a non-boolean maximized flag as false", () => {
    expect(normalizeWindowState({ width: 1280, height: 800, maximized: "yes" })?.maximized).toBe(false);
  });
});

describe("fitWindowStateToDisplays", () => {
  const displays = [
    { x: 0, y: 0, width: 1920, height: 1040 },
    { x: 1920, y: 0, width: 2560, height: 1400 },
  ];

  it("keeps a position that intersects a display", () => {
    const state = { width: 1280, height: 800, x: 1800, y: 200, maximized: false };
    expect(fitWindowStateToDisplays(state, displays)).toEqual(state);
  });

  it("drops a position stranded on an unplugged monitor", () => {
    const state = { width: 1280, height: 800, x: 5000, y: 200, maximized: true };
    expect(fitWindowStateToDisplays(state, displays)).toEqual({
      width: 1280,
      height: 800,
      maximized: true,
    });
  });

  it("passes size-only snapshots through untouched", () => {
    const state = { width: 1280, height: 800, maximized: false };
    expect(fitWindowStateToDisplays(state, displays)).toEqual(state);
  });

  it("drops the position when no displays are reported at all", () => {
    expect(fitWindowStateToDisplays({ width: 1280, height: 800, x: 10, y: 10, maximized: false }, [])).toEqual({
      width: 1280,
      height: 800,
      maximized: false,
    });
  });
});

describe("loadWindowState / saveWindowState", () => {
  it("returns null when no state file exists", () => {
    expect(loadWindowState(path.join(dir, "window-state.json"))).toBeNull();
  });

  it("returns null for corrupt JSON instead of throwing", () => {
    const file = path.join(dir, "window-state.json");
    writeFileSync(file, "{not json", "utf8");
    expect(loadWindowState(file)).toBeNull();
  });

  it("round-trips a snapshot through disk", () => {
    const file = windowStateFile(dir);
    const state = { width: 1600, height: 1000, x: 12, y: 24, maximized: true };
    saveWindowState(file, state);
    expect(loadWindowState(file)).toEqual(state);
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual(state);
  });

  it("never throws when the target directory is unwritable", () => {
    expect(() =>
      saveWindowState(path.join(dir, "missing", "deep", "window-state.json"), {
        width: 1280,
        height: 800,
        maximized: false,
      }),
    ).not.toThrow();
  });
});
