import { describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Context } from "@innocenceharness/kernel";
import { archiveTool, ArchivePlugin } from "../src/index";

async function workspace(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "archive-ws-"));
}

const ctxFor = (workspaceRoot: string) =>
  ({
    scope: { sessionId: "s", taskId: "t", routeId: "main", invocationId: "i" },
    workspaceRoot,
    signal: new AbortController().signal,
  }) as unknown as Parameters<typeof archiveTool.execute>[1];

describe("make_archive tool", () => {
  it("bundles workspace files into a zip inside the workspace", async () => {
    const root = await workspace();
    await mkdir(path.join(root, "logs"), { recursive: true });
    await writeFile(path.join(root, "logs", "run.log"), "line-1\nline-2\n", "utf8");
    await writeFile(path.join(root, "notes.md"), "# notes", "utf8");

    const result = await archiveTool.execute(
      { paths: ["logs/run.log", "notes.md"], output: "dist/bundle.zip" },
      ctxFor(root),
    );

    expect(result.isError).toBe(false);
    const blob = await readFile(path.join(root, "dist", "bundle.zip"));
    expect(blob.subarray(0, 2).toString("latin1")).toBe("PK");
    expect(String(result.content)).toContain("2 个条目");
  });

  it("refuses to read or write outside the workspace root", async () => {
    const root = await workspace();
    await expect(
      archiveTool.execute({ paths: ["../../outside.txt"], output: "out.zip" }, ctxFor(root)),
    ).rejects.toThrow("路径越出工作区");
    await writeFile(path.join(root, "a.txt"), "x", "utf8");
    await expect(
      archiveTool.execute({ paths: ["a.txt"], output: "../escape.zip" }, ctxFor(root)),
    ).rejects.toThrow("路径越出工作区");
  });

  it("rejects missing or malformed arguments", () => {
    expect(() => archiveTool.validateArgs?.({ output: "a.zip" })).toThrow("paths");
    expect(() => archiveTool.validateArgs?.({ paths: [""], output: "a.zip" })).toThrow("paths");
    expect(() => archiveTool.validateArgs?.({ paths: ["a"], output: "" })).toThrow("output");
  });

  it("never persists the passphrase", () => {
    const persisted = archiveTool.persistArgs?.({
      paths: ["a", "b", "c"],
      output: "bundle.zip",
      passphrase: "super-secret",
    });
    expect(persisted).toMatchObject({ output: "bundle.zip", entryCount: 3, encrypted: true });
    expect(JSON.stringify(persisted)).not.toContain("super-secret");
  });
});

describe("archive plugin", () => {
  it("registers the make_archive tool under the plugin name archive", () => {
    const registered: unknown[] = [];
    const ctx = { tools: { register: vi.fn((tool: unknown) => registered.push(tool)) } } as unknown as Context;
    ArchivePlugin.apply(ctx);
    expect(registered).toHaveLength(1);
    expect(ArchivePlugin.name).toBe("archive");
  });
});
