import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  PACKAGED_EXIT_SUCCESS_MARKER,
  inspectRequiredPackageAvailability,
  requireCompletedPackagedAcceptance,
  requirePackagedSmoke,
} from "./runPackageSmoke";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const runner = path.join(repoRoot, "scripts", "packaging", "runPackageSmoke.ts");

describe("package smoke launcher", () => {
  it("fails closed when the packaged smoke artifact is unavailable", () => {
    expect(() => requirePackagedSmoke({ status: "missing-exe", reason: "packaged executable missing" }))
      .toThrow("packaged executable missing");
  });

  it("fails closed when the packaged acceptance run has no actual smoke marker", () => {
    expect(() => requireCompletedPackagedAcceptance(0, "Test Files 1 passed | 1 skipped")).toThrow(
      "did not report the packaged smoke marker",
    );
  });

  it("accepts an exit-zero packaged acceptance run with the smoke marker", () => {
    expect(() => requireCompletedPackagedAcceptance(0, `runner output\n${PACKAGED_EXIT_SUCCESS_MARKER}`)).not.toThrow();
  });

  it("rejects linked package directories before checking packaged artifacts", async () => {
    const repositoryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ic-package-smoke-repo-"));
    const externalRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ic-package-smoke-external-"));
    try {
      const outputRoot = path.join(repositoryRoot, "out");
      const externalPackage = path.join(externalRoot, "InnocenceHarness-win32-x64");
      const packageLink = path.join(outputRoot, "InnocenceHarness-win32-x64");
      await fs.mkdir(outputRoot);
      await fs.mkdir(externalPackage);
      await fs.symlink(externalPackage, packageLink, "junction");

      const availability = await inspectRequiredPackageAvailability(repositoryRoot, packageLink);

      expect(availability).toMatchObject({ status: "missing-exe" });
      expect(availability.reason).toContain("package output must be a real directory");
    } finally {
      await Promise.all([
        fs.rm(repositoryRoot, { recursive: true, force: true }),
        fs.rm(externalRoot, { recursive: true, force: true }),
      ]);
    }
  });

  it("rejects an unknown reparse classification before checking packaged artifacts", async () => {
    const repositoryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ic-package-smoke-reparse-"));
    try {
      const packageDir = path.join(repositoryRoot, "out", "InnocenceHarness-win32-x64");
      await fs.mkdir(packageDir, { recursive: true });

      const availability = await inspectRequiredPackageAvailability(repositoryRoot, packageDir, {
        probeReparsePoint: async () => ({ kind: "unknown", diagnostic: "deterministic test probe" }),
      });

      expect(availability).toMatchObject({ status: "missing-exe" });
      expect(availability.reason).toContain("package output must not be a reparse point");
    } finally {
      await fs.rm(repositoryRoot, { recursive: true, force: true });
    }
  });
  it("exits non-zero with diagnostics when invoked without a package artifact", async () => {
    const missingOut = await fs.mkdtemp(path.join(os.tmpdir(), "ic-package-smoke-missing-"));
    try {
      const child = spawn(process.execPath, [
        "--experimental-strip-types",
        "--experimental-default-type=module",
        runner,
      ], {
        cwd: repoRoot,
        env: { ...process.env, IC_PACKAGE_DIR: path.join(missingOut, "InnocenceHarness-win32-x64") },
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
      let output = "";
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => { output += chunk; });
      child.stderr.on("data", (chunk: string) => { output += chunk; });
      const code = await new Promise<number | null>((resolve) => child.once("exit", resolve));
      expect(code).not.toBe(0);
      expect(output).toMatch(/packaged smoke unavailable|packaged executable missing|IC_PACKAGE_DIR/i);
    } finally {
      await fs.rm(missingOut, { recursive: true, force: true });
    }
  }, 30_000);
});
