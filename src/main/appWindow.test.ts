import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  app: { getPath: vi.fn(() => "") },
  BrowserWindow: class {},
  nativeTheme: { shouldUseDarkColors: false },
}));

import { isAllowedNavigationUrl } from "./appWindow";

describe("isAllowedNavigationUrl", () => {
  it.each([
    "innocenceharness://app/index.html",
    "innocenceharness://app.evil/index.html",
    "innocenceharness://app@evil/index.html",
    "innocenceharness://application/index.html",
  ])("requires the exact app scheme origin for %s", (url) => {
    expect(isAllowedNavigationUrl(url, undefined)).toBe(url === "innocenceharness://app/index.html");
  });

  it.each([
    ["http://localhost:5173/index.html", "http://localhost:5173"],
    ["http://localhost:5173.evil/index.html", "http://localhost:5173"],
    ["http://localhost:5173.evil/index.html", "http://localhost:5173/"],
    ["http://localhost:5174/index.html", "http://localhost:5173"],
  ])("compares dev server origins strictly: %s against %s", (url, devServerUrl) => {
    expect(isAllowedNavigationUrl(url, devServerUrl)).toBe(url === "http://localhost:5173/index.html");
  });

  it("rejects malformed navigation URLs", () => {
    expect(isAllowedNavigationUrl("not a URL", undefined)).toBe(false);
  });

  it("uses the renamed smoke handshake variable", () => {
    const source = readFileSync(path.join(__dirname, "appWindow.ts"), "utf8");
    expect(source).toContain("process.env.InnocenceHarness_SMOKE_OUT");
    expect(source).not.toContain("process.env.InnocenceCode_SMOKE_OUT");
  });
});

