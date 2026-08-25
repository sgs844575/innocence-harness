import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { inspectPackagedSmoke, type PackageAvailability } from "./packagedAvailability.ts";
import {
  defaultExecutableName as defaultPackagedExecutableName,
  defaultPackageDirectory as defaultPackagedDirectory,
  inspectSafePackageDirectory,
  type OutPreflightOptions,
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

export const PACKAGED_EXIT_SUCCESS_MARKER = "[packaged-exit] residue sweep clean (no processes, no lock leases)";

export function requireCompletedPackagedAcceptance(exitCode: number, output: string): void {
  if (exitCode !== 0) {
    throw new Error(`packaged acceptance exited with code ${exitCode}`);
  }
  if (!output.includes(PACKAGED_EXIT_SUCCESS_MARKER)) {
    throw new Error(`packaged acceptance did not report the packaged smoke marker: ${PACKAGED_EXIT_SUCCESS_MARKER}`);
  }
}

export async function inspectRequiredPackageAvailability(
  repoRoot: string,
  requestedPackageDirectory: string,
  options: Pick<OutPreflightOptions, "probeReparsePoint"> = {},
): Promise<SmokeAvailability> {
  let packageDir: string;
  try {
    packageDir = await inspectSafePackageDirectory(requestedPackageDirectory, repoRoot, options);
  } catch (error) {
    return {
      status: "missing-exe",
      reason: `required package directory rejected: ${String(error)}`,
    };
  }

  const packagedExe = path.join(packageDir, defaultPackagedExecutableName());
  const archivePath = path.join(packageDir, "resources", "app.asar");
  const asar = createRequire(import.meta.url)("@electron/asar") as { listPackage(archive: string): string[] };
  return inspectPackagedSmoke(
    undefined,
    packagedExe,
    archivePath,
    () => asar.listPackage(archivePath),
  );
}

function packageDirectory(repoRoot: string): string {
  return process.env.INNOCENCEHARNESS_PACKAGE_DIR
    ? path.resolve(process.env.INNOCENCEHARNESS_PACKAGE_DIR)
    : defaultPackagedDirectory(repoRoot);
}

async function inspectAvailability(repoRoot: string): Promise<SmokeAvailability> {
  return inspectRequiredPackageAvailability(repoRoot, packageDirectory(repoRoot));
}

interface AcceptanceResult {
  exitCode: number;
  output: string;
}

async function runAcceptance(repoRoot: string): Promise<AcceptanceResult> {
  const vitest = path.join(repoRoot, "node_modules", "vitest", "vitest.mjs");
  const child = spawn(process.execPath, [vitest, "run", "tests/packaged-exit.acceptance.test.ts"], {
    cwd: repoRoot,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  let output = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => { output += chunk; process.stdout.write(chunk); });
  child.stderr.on("data", (chunk: string) => { output += chunk; process.stderr.write(chunk); });
  return await new Promise<AcceptanceResult>((resolve) => {
    child.once("error", (error) => {
      const message = `PACKAGE_SMOKE runner failed to start Vitest: ${String(error)}`;
      console.error(message);
      resolve({ exitCode: 1, output: `${output}\n${message}` });
    });
    child.once("exit", (code) => resolve({ exitCode: code ?? 1, output }));
  });
}

export async function runPackageSmoke(): Promise<number> {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  const availability = await inspectAvailability(repoRoot);
  try {
    requirePackagedSmoke(availability);
  } catch (error) {
    console.error(`PACKAGE_SMOKE unavailable: ${availability.reason}`);
    console.error(String(error));
    return 2;
  }
  console.log(`PACKAGE_SMOKE available: ${availability.reason}`);
  const acceptance = await runAcceptance(repoRoot);
  try {
    requireCompletedPackagedAcceptance(acceptance.exitCode, acceptance.output);
  } catch (error) {
    console.error(`PACKAGE_SMOKE acceptance incomplete: ${String(error)}`);
    return 2;
  }
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  void runPackageSmoke().then((code) => { process.exitCode = code; });
}
