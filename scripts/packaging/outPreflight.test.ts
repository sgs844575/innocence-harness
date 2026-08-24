import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cleanPackageOutput, normalizeForComparison } from "./outPreflight";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

async function createTempOutRoot(): Promise<{ repositoryRoot: string; outputRoot: string }> {
  const repositoryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ic-out-preflight-repo-"));
  temporaryRoots.push(repositoryRoot);
  const outputRoot = path.join(repositoryRoot, "out");
  await fs.mkdir(outputRoot, { recursive: true });
  return { repositoryRoot, outputRoot };
}

describe("cleanPackageOutput", () => {
  it("preserves case on case-sensitive platforms", () => {
    const upper = normalizeForComparison("/tmp/InnocenceCode-Out");
    const lower = normalizeForComparison("/tmp/innocencecode-out");

    if (process.platform === "win32") {
      expect(upper).toBe(lower);
    } else {
      expect(upper).not.toBe(lower);
    }
  });

  it("rejects cleaning an out path outside the repository", async () => {
    const { repositoryRoot } = await createTempOutRoot();

    await expect(cleanPackageOutput(path.join(os.tmpdir(), "external-out"), repositoryRoot)).rejects.toThrow(
      "package output must be inside repository",
    );
  });

  it("only removes known package output directories", async () => {
    const { repositoryRoot, outputRoot } = await createTempOutRoot();
    await fs.mkdir(path.join(outputRoot, "InnocenceCode-win32-x64"), { recursive: true });
    await fs.writeFile(path.join(outputRoot, "InnocenceCode-win32-x64", "old.txt"), "old");

    const result = await cleanPackageOutput(outputRoot, repositoryRoot);

    expect(result.outputRoot).toBe(path.resolve(outputRoot));
    expect(result.removed).toEqual(["InnocenceCode-win32-x64"]);
    expect(result.lockDiagnostics).toEqual([]);
    await expect(fs.stat(path.join(outputRoot, "InnocenceCode-win32-x64"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("normalizes a known package child path and removes only that package", async () => {
    const { repositoryRoot, outputRoot } = await createTempOutRoot();
    const packageDir = path.join(outputRoot, "InnocenceCode-win32-x64");
    await fs.mkdir(packageDir, { recursive: true });
    await fs.mkdir(path.join(outputRoot, "InnocenceCode-darwin-arm64"), { recursive: true });

    const result = await cleanPackageOutput(path.join(outputRoot, ".", "InnocenceCode-win32-x64", "."), repositoryRoot);

    expect(result.removed).toEqual(["InnocenceCode-win32-x64"]);
    await expect(fs.stat(packageDir)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(fs.stat(path.join(outputRoot, "InnocenceCode-darwin-arm64"))).resolves.toBeTruthy();
  });

  it("rejects an unknown package subdirectory", async () => {
    const { repositoryRoot, outputRoot } = await createTempOutRoot();
    const unknownPath = path.join(outputRoot, "user-data");
    await fs.mkdir(unknownPath, { recursive: true });

    await expect(cleanPackageOutput(unknownPath, repositoryRoot)).rejects.toThrow(
      "package output must be a known package directory",
    );
    await expect(fs.stat(unknownPath)).resolves.toBeTruthy();
  });

  it("returns path, error code, and bounded retry diagnostics when removal is locked", async () => {
    const { repositoryRoot, outputRoot } = await createTempOutRoot();
    const packageDir = path.join(outputRoot, "InnocenceCode-win32-x64");
    await fs.mkdir(packageDir, { recursive: true });
    let attempts = 0;

    const result = await cleanPackageOutput(outputRoot, repositoryRoot, {
      retryDelayMs: 0,
      remove: async () => {
        attempts += 1;
        const error = new Error("file is in use") as NodeJS.ErrnoException;
        error.code = "EBUSY";
        throw error;
      },
    });

    expect(attempts).toBe(3);
    expect(result.removed).toEqual([]);
    expect(result.lockDiagnostics).toHaveLength(1);
    expect(result.lockDiagnostics[0]).toContain(path.resolve(packageDir));
    expect(result.lockDiagnostics[0]).toContain("EBUSY");
    expect(result.lockDiagnostics[0]).toContain("retry");
    await expect(fs.stat(packageDir)).resolves.toBeTruthy();
  });

  it("rejects an ordinary file supplied as a known package path", async () => {
    const { repositoryRoot, outputRoot } = await createTempOutRoot();
    const packagePath = path.join(outputRoot, "InnocenceCode-win32-x64");
    await fs.writeFile(packagePath, "not a directory");

    await expect(cleanPackageOutput(packagePath, repositoryRoot)).rejects.toThrow("package output must be a real directory");
    await expect(fs.stat(packagePath)).resolves.toBeTruthy();
  });

  it("rejects a symlinked known package path and leaves the link intact", async () => {
    const { repositoryRoot, outputRoot } = await createTempOutRoot();
    const externalRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ic-out-preflight-package-link-"));
    temporaryRoots.push(externalRoot);
    const externalPackage = path.join(externalRoot, "InnocenceCode-win32-x64");
    const packageLink = path.join(outputRoot, "InnocenceCode-win32-x64");
    await fs.mkdir(externalPackage, { recursive: true });
    await fs.symlink(externalPackage, packageLink, "junction");

    await expect(cleanPackageOutput(packageLink, repositoryRoot)).rejects.toThrow("package output must be a real directory");
    await expect(fs.lstat(packageLink)).resolves.toMatchObject({ isSymbolicLink: expect.any(Function) });
    await expect(fs.stat(externalPackage)).resolves.toBeTruthy();
  });
  it("rejects a known package file among output children without deleting it", async () => {
    const { repositoryRoot, outputRoot } = await createTempOutRoot();
    const packageFile = path.join(outputRoot, "InnocenceCode-win32-x64");
    await fs.writeFile(packageFile, "not a directory");

    await expect(cleanPackageOutput(outputRoot, repositoryRoot)).rejects.toThrow("package output must be a real directory");
    await expect(fs.stat(packageFile)).resolves.toBeTruthy();
  });

  it("rejects a junction among output children without deleting the link or target", async () => {
    const { repositoryRoot, outputRoot } = await createTempOutRoot();
    const externalRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ic-out-preflight-child-link-"));
    temporaryRoots.push(externalRoot);
    const externalPackage = path.join(externalRoot, "InnocenceCode-win32-x64");
    const packageLink = path.join(outputRoot, "InnocenceCode-win32-x64");
    await fs.mkdir(externalPackage, { recursive: true });
    await fs.symlink(externalPackage, packageLink, "junction");

    await expect(cleanPackageOutput(outputRoot, repositoryRoot)).rejects.toThrow("package output must be a real directory");
    await expect(fs.lstat(packageLink)).resolves.toMatchObject({ isSymbolicLink: expect.any(Function) });
    await expect(fs.stat(externalPackage)).resolves.toBeTruthy();
  });
  it("rejects a known package name nested below the repository out root", async () => {
    const { repositoryRoot, outputRoot } = await createTempOutRoot();
    const nestedPackageDir = path.join(outputRoot, "nested", "InnocenceCode-win32-x64");
    await fs.mkdir(nestedPackageDir, { recursive: true });

    await expect(cleanPackageOutput(nestedPackageDir, repositoryRoot)).rejects.toThrow(
      "package output must be a direct child of repository out",
    );
    await expect(fs.stat(nestedPackageDir)).resolves.toBeTruthy();
  });
  it("rejects an out directory whose canonical target is outside the repository", async () => {
    const repositoryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ic-out-preflight-repo-link-"));
    const externalOut = await fs.mkdtemp(path.join(os.tmpdir(), "ic-out-preflight-external-"));
    temporaryRoots.push(repositoryRoot, externalOut);
    await fs.symlink(externalOut, path.join(repositoryRoot, "out"), "junction");

    await expect(cleanPackageOutput(path.join(repositoryRoot, "out"), repositoryRoot)).rejects.toThrow(
      "canonical package output must be the repository out directory",
    );
  });
});
