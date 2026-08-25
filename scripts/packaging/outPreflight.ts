import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defaultReparsePointProbe, type ReparseProbeResult } from "./reparseProbe.ts";

const DEFAULT_RETRY_DELAYS_MS = [100, 250, 500] as const;
const OUTPUT_DIRECTORY_NAME = "out";
const PRODUCT_NAME = "InnocenceHarness";
const PACKAGE_DIRECTORY_PATTERN = new RegExp(`^${PRODUCT_NAME}-(?:win32|darwin|linux)-(?:x64|arm64|ia32|arm)$`);

export function defaultPackageDirectory(repositoryRoot: string): string {
  return path.join(path.resolve(repositoryRoot), OUTPUT_DIRECTORY_NAME, `${PRODUCT_NAME}-win32-x64`);
}

export function defaultExecutableName(): string {
  return `${PRODUCT_NAME}.exe`;
}

export interface OutPreflightResult {
  outputRoot: string;
  removed: string[];
  lockDiagnostics: string[];
}

export interface OutPreflightOptions {
  retryDelayMs?: number;
  remove?: (target: string) => Promise<void>;
  probeReparsePoint?: (target: string) => Promise<ReparseProbeResult>;
}

export function normalizeForComparison(value: string): string {
  const normalized = path.resolve(value).replace(/[\\/]+/g, path.sep).replace(/[\\/]$/, "");
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function isWithinPath(candidate: string, parent: string): boolean {
  const candidatePath = normalizeForComparison(candidate);
  const parentPath = normalizeForComparison(parent);
  return candidatePath === parentPath || candidatePath.startsWith(`${parentPath}${path.sep}`);
}

export function isKnownPackageDirectory(packageDirectory: string): boolean {
  return PACKAGE_DIRECTORY_PATTERN.test(path.basename(path.resolve(packageDirectory)));
}

async function realPathIfPresent(candidate: string): Promise<string> {
  try {
    return await fs.realpath(candidate);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return path.resolve(candidate);
    throw new Error(`Unable to resolve package output path ${candidate}: ${String(error)}`, { cause: error });
  }
}

async function inspectRealDirectory(
  target: string,
  canonicalParent: string,
  label: string,
  probeReparsePoint: (target: string) => Promise<ReparseProbeResult>,
): Promise<string> {
  let entry: import("node:fs").Stats;
  try {
    entry = await fs.lstat(target);
  } catch (error) {
    throw new Error(`package output must be a real directory (${label}): ${target}`, { cause: error });
  }
  if (!entry.isDirectory() || entry.isSymbolicLink()) {
    throw new Error(`package output must be a real directory (${label}): ${target}`);
  }
  const reparse = await probeReparsePoint(target);
  if (reparse.kind !== "ordinary") {
    throw new Error(
      `package output must not be a reparse point (${label}): ${target}; kind=${reparse.kind}; diagnostic=${reparse.diagnostic ?? "none"}`,
    );
  }

  const canonicalTarget = await realPathIfPresent(target);
  if (!isWithinPath(canonicalTarget, canonicalParent) || normalizeForComparison(path.dirname(canonicalTarget)) !== normalizeForComparison(canonicalParent)) {
    throw new Error(`package output canonical path escaped repository out (${label}): ${canonicalTarget}`);
  }
  return canonicalTarget;
}

export function assertKnownPackageDirectory(
  packageDirectory: string,
  repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.."),
): string {
  const repository = path.resolve(repositoryRoot);
  const outputRoot = path.resolve(repository, OUTPUT_DIRECTORY_NAME);
  const resolvedPackageDirectory = path.resolve(packageDirectory);

  if (!isWithinPath(resolvedPackageDirectory, outputRoot)) {
    throw new Error(`package output must be inside repository: ${resolvedPackageDirectory}`);
  }
  if (resolvedPackageDirectory === outputRoot || path.dirname(resolvedPackageDirectory) !== outputRoot) {
    throw new Error(`package output must be a direct child of repository out: ${resolvedPackageDirectory}`);
  }
  if (!isKnownPackageDirectory(resolvedPackageDirectory)) {
    throw new Error(`package output must be a known package directory: ${resolvedPackageDirectory}`);
  }
  return resolvedPackageDirectory;
}

export async function inspectSafePackageDirectory(
  packageDirectory: string,
  repositoryRoot: string,
  options: Pick<OutPreflightOptions, "probeReparsePoint"> = {},
): Promise<string> {
  const repository = path.resolve(repositoryRoot);
  const outputRoot = path.resolve(repository, OUTPUT_DIRECTORY_NAME);
  const canonicalRepository = await realPathIfPresent(repository);
  const canonicalOutputRoot = await realPathIfPresent(outputRoot);
  if (!isWithinPath(canonicalOutputRoot, canonicalRepository) || normalizeForComparison(path.dirname(canonicalOutputRoot)) !== normalizeForComparison(canonicalRepository)) {
    throw new Error(`canonical package output must be the repository out directory: ${canonicalOutputRoot}`);
  }

  const resolvedPackageDirectory = assertKnownPackageDirectory(packageDirectory, repository);
  return inspectRealDirectory(
    resolvedPackageDirectory,
    canonicalOutputRoot,
    "requested package",
    options.probeReparsePoint ?? defaultReparsePointProbe,
  );
}

function formatLockDiagnostic(target: string, error: unknown, attempts: number): string {
  const code = (error as NodeJS.ErrnoException).code ?? "UNKNOWN";
  const message = error instanceof Error ? error.message : String(error);
  return `Unable to remove locked package output ${target}; code=${code}; attempts=${attempts}; retry was bounded; inspect the owning process and retry package preflight safely. cause=${message}`;
}

async function removeWithBoundedRetry(
  target: string,
  options: OutPreflightOptions,
): Promise<string | null> {
  const remove = options.remove ?? (async (entry: string) => fs.rm(entry, { recursive: true, force: true }));
  const baseDelay = Math.max(0, options.retryDelayMs ?? DEFAULT_RETRY_DELAYS_MS[0]);
  let lastError: unknown;

  for (let attempt = 0; attempt < DEFAULT_RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      await remove(target);
      return null;
    } catch (error) {
      lastError = error;
      if (attempt === DEFAULT_RETRY_DELAYS_MS.length - 1) break;
      const delay = options.retryDelayMs === undefined ? DEFAULT_RETRY_DELAYS_MS[attempt] : baseDelay * 2 ** attempt;
      if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  return formatLockDiagnostic(target, lastError, DEFAULT_RETRY_DELAYS_MS.length);
}

async function knownPackageChildren(
  outputRoot: string,
  canonicalOutputRoot: string,
  probeReparsePoint: (target: string) => Promise<ReparseProbeResult>,
): Promise<string[]> {
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(outputRoot, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw new Error(`Unable to inspect package output at ${outputRoot}: ${String(error)}`, { cause: error });
  }

  const packageNames = entries
    .filter((entry) => isKnownPackageDirectory(path.join(outputRoot, entry.name)))
    .map((entry) => entry.name)
    .sort();
  for (const packageName of packageNames) {
    await inspectRealDirectory(path.join(outputRoot, packageName), canonicalOutputRoot, "package child", probeReparsePoint);
  }
  return packageNames;
}

export async function cleanPackageOutput(
  outputRoot: string,
  repositoryRoot: string,
  options: OutPreflightOptions = {},
): Promise<OutPreflightResult> {
  const repository = path.resolve(repositoryRoot);
  const repositoryOutputRoot = path.resolve(repository, OUTPUT_DIRECTORY_NAME);
  const resolvedOutputRoot = path.resolve(outputRoot);
  const canonicalRepository = await realPathIfPresent(repository);
  const canonicalRepositoryOutputRoot = await realPathIfPresent(repositoryOutputRoot);

  if (!isWithinPath(canonicalRepositoryOutputRoot, canonicalRepository) || path.dirname(canonicalRepositoryOutputRoot) !== canonicalRepository) {
    throw new Error(`canonical package output must be the repository out directory: ${canonicalRepositoryOutputRoot}`);
  }

  const isRepositoryOutputRoot = normalizeForComparison(resolvedOutputRoot) === normalizeForComparison(repositoryOutputRoot);
  const isPackageDirectory = isKnownPackageDirectory(resolvedOutputRoot);

  if (!isWithinPath(resolvedOutputRoot, repositoryOutputRoot)) {
    throw new Error(`package output must be inside repository: ${resolvedOutputRoot}`);
  }
  if (!isRepositoryOutputRoot && path.dirname(resolvedOutputRoot) !== repositoryOutputRoot) {
    throw new Error(`package output must be a direct child of repository out: ${resolvedOutputRoot}`);
  }
  if (!isRepositoryOutputRoot && !isPackageDirectory) {
    throw new Error(`package output must be a known package directory: ${resolvedOutputRoot}`);
  }

  const probeReparsePoint = options.probeReparsePoint ?? defaultReparsePointProbe;
  const packageNames = isRepositoryOutputRoot
    ? await knownPackageChildren(resolvedOutputRoot, canonicalRepositoryOutputRoot, probeReparsePoint)
    : [path.basename(resolvedOutputRoot)];
  if (!isRepositoryOutputRoot) {
    await inspectRealDirectory(resolvedOutputRoot, canonicalRepositoryOutputRoot, "requested package", probeReparsePoint);
  }
  const packageTargets = isRepositoryOutputRoot
    ? packageNames.map((packageName) => path.resolve(resolvedOutputRoot, packageName))
    : [resolvedOutputRoot];
  const removed: string[] = [];
  const lockDiagnostics: string[] = [];

  for (const [index, packageTarget] of packageTargets.entries()) {
    const diagnostic = await removeWithBoundedRetry(packageTarget, options);
    if (diagnostic === null) {
      removed.push(packageNames[index]);
    } else {
      lockDiagnostics.push(diagnostic);
    }
  }

  return { outputRoot: resolvedOutputRoot, removed, lockDiagnostics };
}

async function runPreflight(): Promise<void> {
  const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  const result = await cleanPackageOutput(path.join(repositoryRoot, OUTPUT_DIRECTORY_NAME), repositoryRoot);
  for (const removed of result.removed) console.log(`PACKAGE_PREFLIGHT removed ${path.join(result.outputRoot, removed)}`);
  if (result.lockDiagnostics.length > 0) {
    for (const diagnostic of result.lockDiagnostics) console.error(`PACKAGE_PREFLIGHT lock ${diagnostic}`);
    process.exitCode = 2;
    return;
  }
  console.log(`PACKAGE_PREFLIGHT ok outputRoot=${result.outputRoot} removed=${result.removed.length}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  void runPreflight().catch((error: unknown) => {
    console.error(`PACKAGE_PREFLIGHT fail ${String(error)}`);
    process.exitCode = 1;
  });
}
