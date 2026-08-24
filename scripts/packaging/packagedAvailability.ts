import { existsSync } from "node:fs";

export interface PackageAvailability {
  status: "missing-exe" | "missing-archive" | "missing-smoke" | "available";
  reason: string;
}

export function inspectPackagedSmoke(
  packageReason: string | undefined,
  packagedExe: string,
  archivePath: string,
  listArchive: () => string[],
): PackageAvailability {
  if (packageReason !== undefined) {
    return { status: "missing-exe", reason: packageReason };
  }
  if (!existsSync(packagedExe)) {
    return { status: "missing-exe", reason: `packaged executable missing: ${packagedExe}` };
  }
  if (!existsSync(archivePath)) {
    return { status: "missing-archive", reason: `packaged archive missing: ${archivePath}` };
  }
  const entry = listArchive().find((key) => key.replaceAll("\\", "/").endsWith("/.vite/build/smoke.js"));
  if (entry === undefined) {
    return { status: "missing-smoke", reason: `smoke entry missing from packaged archive: ${archivePath}` };
  }
  return { status: "available", reason: `smoke entry available: ${entry}` };
}
