import { describe, expect, it } from "vitest";
import { squirrelEventFromArgv, squirrelShortcutAction, updateExeFor } from "./squirrel-events";

describe("squirrelEventFromArgv", () => {
  it("maps every installer-launched argument to its event", () => {
    expect(squirrelEventFromArgv(["app.exe", "--squirrel-install"])).toBe("install");
    expect(squirrelEventFromArgv(["app.exe", "--squirrel-updated"])).toBe("updated");
    expect(squirrelEventFromArgv(["app.exe", "--squirrel-uninstall"])).toBe("uninstall");
    expect(squirrelEventFromArgv(["app.exe", "--squirrel-obsolete"])).toBe("obsolete");
  });

  it("returns null for normal boots (dev argv, packaged run, firstrun)", () => {
    expect(squirrelEventFromArgv(["electron.exe", "."])).toBeNull();
    expect(squirrelEventFromArgv(["InnocenceHarness.exe"])).toBeNull();
    expect(squirrelEventFromArgv(["InnocenceHarness.exe", "--squirrel-firstrun"])).toBeNull();
    expect(squirrelEventFromArgv(["InnocenceHarness.exe", "file.txt"])).toBeNull();
  });
});

describe("updateExeFor", () => {
  it("resolves Update.exe in the install root above the versioned app dir", () => {
    const exe = "C:\\Users\\u\\AppData\\Local\\InnocenceHarness\\app-0.1.0\\InnocenceHarness.exe";
    expect(updateExeFor(exe)).toBe("C:\\Users\\u\\AppData\\Local\\InnocenceHarness\\Update.exe");
  });
});

describe("squirrelShortcutAction", () => {
  const exe = "C:\\Install\\app-0.1.0\\InnocenceHarness.exe";

  it("install and updated request shortcut creation", () => {
    expect(squirrelShortcutAction("install", exe)).toEqual({
      exe: "C:\\Install\\Update.exe",
      args: ["--createShortcut", "InnocenceHarness.exe"],
    });
    expect(squirrelShortcutAction("updated", exe)).toEqual({
      exe: "C:\\Install\\Update.exe",
      args: ["--createShortcut", "InnocenceHarness.exe"],
    });
  });

  it("uninstall requests shortcut removal; obsolete has no action", () => {
    expect(squirrelShortcutAction("uninstall", exe)).toEqual({
      exe: "C:\\Install\\Update.exe",
      args: ["--removeShortcut", "InnocenceHarness.exe"],
    });
    expect(squirrelShortcutAction("obsolete", exe)).toBeNull();
  });
});
