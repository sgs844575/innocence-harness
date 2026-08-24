import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { inspectPackagedSmoke } from "../scripts/packaging/packagedAvailability";

const temporaryRoots: string[] = [];
const selectionReason = undefined;

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

async function createPackageFixture(): Promise<{ executable: string; archive: string }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ic-packaged-availability-"));
  temporaryRoots.push(root);
  const executable = path.join(root, "InnocenceCode.exe");
  const archive = path.join(root, "app.asar");
  await fs.writeFile(executable, "fixture");
  await fs.writeFile(archive, "fixture");
  return { executable, archive };
}

describe("inspectPackagedSmoke", () => {
  it("skips when the executable is missing", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "ic-packaged-missing-exe-"));
    temporaryRoots.push(root);

    expect(inspectPackagedSmoke(selectionReason, path.join(root, "InnocenceCode.exe"), path.join(root, "app.asar"), () => [])).toEqual(
      expect.objectContaining({ status: "missing-exe" }),
    );
  });

  it("skips when the executable exists but the archive is missing", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "ic-packaged-missing-archive-"));
    temporaryRoots.push(root);
    const executable = path.join(root, "InnocenceCode.exe");
    await fs.writeFile(executable, "fixture");

    expect(inspectPackagedSmoke(selectionReason, executable, path.join(root, "app.asar"), () => [])).toEqual(
      expect.objectContaining({ status: "missing-archive" }),
    );
  });

  it("reports an available smoke entry when the archive contains it", async () => {
    const { executable, archive } = await createPackageFixture();

    expect(inspectPackagedSmoke(selectionReason, executable, archive, () => [".vite/build/smoke.js"])).toEqual(
      expect.objectContaining({ status: "available" }),
    );
  });
  it("rejects a nested smoke entry as missing", async () => {
    const { executable, archive } = await createPackageFixture();

    expect(inspectPackagedSmoke(selectionReason, executable, archive, () => ["nested/.vite/build/smoke.js"])).toEqual(
      expect.objectContaining({ status: "missing-smoke" }),
    );
  });
  it("skips when the archive has no smoke entry", async () => {
    const { executable, archive } = await createPackageFixture();

    expect(inspectPackagedSmoke(selectionReason, executable, archive, () => [".vite/build/main.js"])).toEqual(
      expect.objectContaining({ status: "missing-smoke" }),
    );
  });

  it("fails when archive inspection throws instead of converting the error to a skip", async () => {
    const { executable, archive } = await createPackageFixture();

    expect(() => inspectPackagedSmoke(selectionReason, executable, archive, () => {
      throw new Error("archive parse failed");
    })).toThrow("archive parse failed");
  });
});
