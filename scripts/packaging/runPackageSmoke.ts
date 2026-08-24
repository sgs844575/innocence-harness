import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { inspectPackagedSmoke, type PackageAvailability } from "./packagedAvailability.ts";
import {
  assertKnownPackageDirectory,
  defaultExecutableName as defaultPackagedExecutableName,
  defaultPackageDirectory as defaultPackagedDirectory,
} from "./outPreflight.ts";

export interface SmokeAvailability {
  status: PackageAvailability["status"];
  reason: string;
}

/** Convert an unavailable package into a hard smoke failure. */
export function requirePackagedSmoke(availability: SmokeAvailability): void {
  if (availability.status !== "available") {
    throw new Error(`packaged smoke unavailable: ${availability.reason}`);
  }
}

function packageDirectory(repoRoot: string): string {
  return process.env.IC_PACKAGE_DIR
    ? path.resolve(process.env.IC_PACKAGE_DIR)
    : defaultPackagedDirectory(repoRoot);
}

function inspectAvailability(repoRoot: string): SmokeAvailability {
  const packageDir = packageDirectory(repoRoot);
  const packagedExe = path.join(packageDir, defaultPackagedExecutableName());
  let packageReason: string | undefined;
  try {
    assertKnownPackageDirectory(packageDir, repoRoot);
  } catch (error) {
    packageReason = `IC_PACKAGE_DIR must point to a known direct package directory under ${path.join(repoRoot, "out")}: ${String(error)}`;
  }
  const archivePath = path.join(packageDir, "resources", "app.asar");
  const asar = createRequire(import.meta.url)("@electron/asar") as { listPackage(archive: string): string[] };
  return inspectPackagedSmoke(
    packageReason,
    packagedExe,
    archivePath,
    () => asar.listPackage(archivePath),
  );
}

async function runAcceptance(repoRoot: string): Promise<number> {
  const vitest = path.join(repoRoot, "node_modules", "vitest", "vitest.mjs");
  const child = spawn(process.execPath, [vitest, "run", "tests/packaged-exit.acceptance.test.ts"], {
    cwd: repoRoot,
    env: process.env,
    stdio: "inherit",
    windowsHide: true,
  });
  return await new Promise<number>((resolve) => {
    child.once("error", (error) => {
      console.error(`PACKAGE_SMOKE runner failed to start Vitest: ${String(error)}`);
      resolve(1);
    });
    child.once("exit", (code) => resolve(code ?? 1));
  });
}

export async function runPackageSmoke(): Promise<number> {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  const availability = inspectAvailability(repoRoot);
  try {
    requirePackagedSmoke(availability);
  } catch (error) {
    console.error(`PACKAGE_SMOKE unavailable: ${availability.reason}`);
    console.error(String(error));
    return 2;
  }
  console.log(`PACKAGE_SMOKE available: ${availability.reason}`);
  return runAcceptance(repoRoot);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  void runPackageSmoke().then((code) => { process.exitCode = code; });
}
