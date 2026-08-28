import { describe, expect, it } from "vitest";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { assertKernelModuleIdentity } from "./kernelIdentity";

async function stagedKernel(version: string, scopeName = "@innocenceharness/kernel"): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "kernel-id-"));
  const pkgDir = path.join(root, "node_modules", ...scopeName.split("/"));
  await mkdir(path.join(pkgDir, "dist"), { recursive: true });
  await writeFile(path.join(pkgDir, "package.json"), JSON.stringify({ name: scopeName, version }), "utf8");
  await writeFile(path.join(pkgDir, "dist", "index.js"), "export default {}", "utf8");
  return path.join(pkgDir, "dist", "index.js");
}

describe("assertKernelModuleIdentity", () => {
  it("accepts the expected kernel package within the supported range", async () => {
    const kernelPath = await stagedKernel("0.1.0");
    expect(() => assertKernelModuleIdentity(kernelPath)).not.toThrow();
  });

  it("rejects paths outside the expected package", async () => {
    const kernelPath = await stagedKernel("0.1.0", "@other-scope/kernel");
    expect(() => assertKernelModuleIdentity(kernelPath)).toThrow("does not resolve to");
  });

  it("rejects paths without a node_modules segment", () => {
    expect(() => assertKernelModuleIdentity(path.join(os.tmpdir(), "kernel", "dist", "index.js"))).toThrow(
      "does not resolve to",
    );
  });

  it("rejects out-of-range versions with the offending version in the error", async () => {
    const kernelPath = await stagedKernel("9.9.9");
    expect(() => assertKernelModuleIdentity(kernelPath)).toThrow("9.9.9 does not satisfy");
  });

  it("rejects unreadable or versionless manifests", async () => {
    const kernelPath = await stagedKernel("0.1.0");
    expect(() =>
      assertKernelModuleIdentity(kernelPath, { readPackageJson: () => { throw new Error("boom"); } }),
    ).toThrow("unreadable");
    expect(() =>
      assertKernelModuleIdentity(kernelPath, { readPackageJson: () => ({ name: "@innocenceharness/kernel" }) }),
    ).toThrow("no version");
  });

  it("honors an injected supported range", async () => {
    const kernelPath = await stagedKernel("0.2.0");
    expect(() => assertKernelModuleIdentity(kernelPath, { supportedRange: "^0.2.0" })).not.toThrow();
    expect(() => assertKernelModuleIdentity(kernelPath)).toThrow("does not satisfy");
  });
});
