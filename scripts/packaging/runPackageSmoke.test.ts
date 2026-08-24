import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { requirePackagedSmoke } from "./runPackageSmoke";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const runner = path.join(repoRoot, "scripts", "packaging", "runPackageSmoke.ts");

describe("package smoke launcher", () => {
  it("fails closed when the packaged smoke artifact is unavailable", () => {
    expect(() => requirePackagedSmoke({ status: "missing-exe", reason: "packaged executable missing" }))
      .toThrow("packaged executable missing");
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
