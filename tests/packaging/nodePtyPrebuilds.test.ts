import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { config, packagingArtifactNames } from "../../forge.config";
import { pruneNodePtyPrebuilds } from "../../scripts/packaging/nodePtyPrebuilds";

const repoRoot = path.resolve(__dirname, "../..");
const sourcePrebuilds = path.join(repoRoot, "node_modules", "node-pty", "prebuilds");
const requiredWin32X64Files = [
  "conpty/conpty.dll",
  "conpty/OpenConsole.exe",
  "conpty_console_list.node",
  "conpty.node",
  "pty.node",
  "winpty-agent.exe",
  "winpty.dll",
];
const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })),
  );
});

async function collectRelativeFiles(root: string): Promise<string[]> {
  const files: string[] = [];

  async function walk(current: string): Promise<void> {
    for (const entry of await fs.readdir(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(absolute);
      } else {
        files.push(path.relative(root, absolute).split(path.sep).join("/"));
      }
    }
  }

  await walk(root);
  return files.sort();
}

async function createStagingFixture(): Promise<string> {
  const stagingRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ic-node-pty-staging-"));
  temporaryRoots.push(stagingRoot);
  const fixturePrebuilds = path.join(stagingRoot, "node_modules", "node-pty", "prebuilds");
  await fs.mkdir(fixturePrebuilds, { recursive: true });

  for (const platform of ["darwin-arm64", "darwin-x64", "win32-arm64", "win32-x64"]) {
    await fs.cp(path.join(sourcePrebuilds, platform), path.join(fixturePrebuilds, platform), {
      recursive: true,
    });
  }
  await fs.writeFile(path.join(stagingRoot, "staging-sentinel.txt"), "keep");
  return stagingRoot;
}

describe("pruneNodePtyPrebuilds", () => {
  it("keeps every win32-x64 file, including conpty and winpty runtime files", async () => {
    const stagingRoot = await createStagingFixture();
    const targetRoot = path.join(stagingRoot, "node_modules", "node-pty", "prebuilds", "win32-x64");
    const beforeFiles = await collectRelativeFiles(targetRoot);

    await pruneNodePtyPrebuilds(stagingRoot);

    await expect(collectRelativeFiles(targetRoot)).resolves.toEqual(beforeFiles);
    for (const requiredFile of requiredWin32X64Files) {
      await expect(fs.stat(path.join(targetRoot, requiredFile))).resolves.toBeTruthy();
    }
  });

  it("removes every non-win32-x64 platform directory and leaves unrelated staging files", async () => {
    const stagingRoot = await createStagingFixture();
    const prebuildsRoot = path.join(stagingRoot, "node_modules", "node-pty", "prebuilds");

    await pruneNodePtyPrebuilds(stagingRoot);

    await expect(fs.readdir(prebuildsRoot)).resolves.toEqual(["win32-x64"]);
    for (const platform of ["darwin-arm64", "darwin-x64", "win32-arm64"]) {
      expect(existsSync(path.join(prebuildsRoot, platform))).toBe(false);
    }
    await expect(fs.readFile(path.join(stagingRoot, "staging-sentinel.txt"), "utf8")).resolves.toBe("keep");
  });

  it("preserves the InnocenceHarness artifact naming and node-pty packaging invariants", async () => {
    const packagerConfig = config.packagerConfig as {
      asar?: { unpack?: string };
      executableName?: string;
      extraResource?: string[];
      afterCopy?: unknown[];
    };
    expect(packagerConfig.asar?.unpack).toBe("**/node_modules/node-pty/**");
    const squirrelMaker = config.makers?.[0] as { prepareConfig?: (arch: "x64") => Promise<void>; config?: { name?: string; setupExe?: string } };
    await squirrelMaker.prepareConfig?.("x64");
    expect(squirrelMaker.config).toMatchObject({
      name: packagingArtifactNames.makerName,
      setupExe: packagingArtifactNames.setupExe,
    });

    expect(packagerConfig.extraResource).toEqual([
      "build/dist/resources/plugins",
      "build/dist/resources/node_modules",
      "assets",
    ]);
    expect(packagerConfig.afterCopy).toHaveLength(1);
  });

  it("includes the path and original cause when a non-target prebuild cannot be removed", async () => {
    const stagingRoot = await createStagingFixture();
    const lockedPlatformRoot = path.join(
      stagingRoot,
      "node_modules",
      "node-pty",
      "prebuilds",
      "darwin-x64",
    );
    const cause = new Error("fixture lock");
    const remove = async (target: string): Promise<void> => {
      if (target === lockedPlatformRoot) throw cause;
      await fs.rm(target, { recursive: true, force: true });
    };

    await expect(pruneNodePtyPrebuilds(stagingRoot, { remove })).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(Error);
      expect(error).toMatchObject({ cause });
      expect(String(error)).toContain(lockedPlatformRoot);
      expect(String(error)).toContain("fixture lock");
      return true;
    });
  });
  it("does nothing when node-pty prebuilds are absent", async () => {
    const stagingRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ic-node-pty-empty-"));
    temporaryRoots.push(stagingRoot);
    await fs.writeFile(path.join(stagingRoot, "staging-sentinel.txt"), "keep");

    await expect(pruneNodePtyPrebuilds(stagingRoot)).resolves.toBeUndefined();
    await expect(fs.readFile(path.join(stagingRoot, "staging-sentinel.txt"), "utf8")).resolves.toBe("keep");
    expect(existsSync(path.join(stagingRoot, "node_modules"))).toBe(false);
  });
});
