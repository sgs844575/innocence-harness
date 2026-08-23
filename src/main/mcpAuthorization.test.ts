import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { authorizeWorkspaceRoot } from "./mcpAuthorization";

let workspaceRoot: string;
let outsideRoot: string;

beforeAll(async () => {
  workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "innocence-mcp-auth-workspace-"));
  outsideRoot = await fs.mkdtemp(path.join(os.tmpdir(), "innocence-mcp-auth-outside-"));
});

afterAll(async () => {
  await fs.rm(workspaceRoot, { recursive: true, force: true });
  await fs.rm(outsideRoot, { recursive: true, force: true });
});

describe("authorizeWorkspaceRoot", () => {
  it("accepts the configured workspace root", async () => {
    await expect(authorizeWorkspaceRoot(workspaceRoot, workspaceRoot)).resolves.toBe(
      await fs.realpath(workspaceRoot),
    );
  });

  it("accepts a traversal path that resolves to the configured root", async () => {
    const traversal = `${workspaceRoot}${path.sep}..${path.sep}${path.basename(workspaceRoot)}`;
    await expect(authorizeWorkspaceRoot(traversal, workspaceRoot)).resolves.toBe(
      await fs.realpath(workspaceRoot),
    );
  });

  it("rejects an arbitrary temporary root", async () => {
    await expect(authorizeWorkspaceRoot(outsideRoot, workspaceRoot)).rejects.toThrow(
      "mcp workspace root is not authorized",
    );
  });

  it("rejects a symlink that resolves outside the configured root", async () => {
    const link = path.join(os.tmpdir(), `innocence-mcp-auth-link-${Date.now().toString(36)}`);
    try {
      await fs.symlink(outsideRoot, link, "junction");
      await expect(authorizeWorkspaceRoot(link, workspaceRoot)).rejects.toThrow(
        "mcp workspace root is not authorized",
      );
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "EPERM" && code !== "EACCES") throw err;
    } finally {
      await fs.rm(link, { recursive: true, force: true });
    }
  });

  it("rejects a nonexistent candidate root", async () => {
    const missing = path.join(outsideRoot, "missing");
    await expect(authorizeWorkspaceRoot(missing, workspaceRoot)).rejects.toThrow(
      "mcp workspace root is not authorized",
    );
  });

  it("rejects empty or unconfigured roots", async () => {
    await expect(authorizeWorkspaceRoot("", workspaceRoot)).rejects.toThrow(
      "mcp workspace root is not authorized",
    );
    await expect(authorizeWorkspaceRoot(workspaceRoot, "")).rejects.toThrow(
      "mcp workspace root is not authorized",
    );
  });
});
