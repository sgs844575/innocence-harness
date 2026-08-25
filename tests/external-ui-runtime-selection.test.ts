import path from "node:path";
import { describe, expect, it } from "vitest";
import { selectExternalUiRuntime } from "./externalUiRuntime";

const executableName = process.platform === "win32" ? "InnocenceHarness.exe" : "InnocenceHarness";
const defaultPackageDirectory = path.join("package-root", "default");
const developmentEntry = path.join("development-root", "desktop-runtime");

function selectionInput(overrides: Partial<Parameters<typeof selectExternalUiRuntime>[0]> = {}) {
  return {
    defaultPackageDirectory,
    developmentEntry,
    executableName,
    isExecutable: (entry: string) => entry === developmentEntry,
    ...overrides,
  };
}

describe("external UI runtime selection", () => {
  it("uses the development runtime when no package directory was requested", () => {
    const result = selectExternalUiRuntime(selectionInput());

    expect(result).toEqual({
      status: "available",
      runtime: { entry: developmentEntry, packaged: false, source: "development" },
    });
  });

  it("forces a valid explicitly requested package directory over development", () => {
    const explicitPackageDirectory = path.join("C:", "packages", "explicit");
    const explicitExecutable = path.join(explicitPackageDirectory, executableName);
    const result = selectExternalUiRuntime(selectionInput({
      requestedPackageDirectory: explicitPackageDirectory,
      isExecutable: (entry) => entry === developmentEntry || entry === explicitExecutable,
    }));

    expect(result).toEqual({
      status: "available",
      runtime: { entry: explicitExecutable, packaged: true, source: "explicit-package" },
    });
  });

  it("reports an invalid explicitly requested package directory without falling back to development", () => {
    const explicitPackageDirectory = path.join("C:", "packages", "missing");
    const explicitExecutable = path.join(explicitPackageDirectory, executableName);
    const result = selectExternalUiRuntime(selectionInput({
      requestedPackageDirectory: explicitPackageDirectory,
    }));

    expect(result).toEqual({
      status: "unavailable",
      reason: `explicit packaged runtime executable not found or not executable: ${explicitExecutable}`,
    });
  });
});
