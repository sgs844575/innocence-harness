import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import memoryPlugin, { listMemoryFiles, readMemoryFile, resolveMemoryFile, validMemoryId, writeEntry, createMemoryTools, createMemoryIndexProcessor } from "../src";

const roots: string[] = [];
async function root() {
  const value = await fs.mkdtemp(path.join(os.tmpdir(), "memory-files-"));
  roots.push(value);
  return value;
}
afterEach(async () => { for (const value of roots.splice(0)) await fs.rm(value, { recursive: true, force: true }); });

describe("memory file surface", () => {
  it("exposes the same file store to browsing, tools and a later session", async () => {
    const workspace = await root();
    const user = await root();
    const options = { getUserRoot: () => user, getProjectRoot: () => workspace };
    const tools = createMemoryTools(options);
    await tools[0].execute({ id: "build-rules", content: "Verify changes.\nKeep durable decisions." }, {} as never);
    await fs.writeFile(path.join(workspace, "memory", "MEMORY.md"), "# Workspace notes\nRead build-rules.md.", "utf8");
    const files = await memoryPlugin.files.list(workspace);
    expect(files.map((file) => file.name)).toEqual(["MEMORY.md", "build-rules.md"]);
    expect(files[0]).toMatchObject({ path: path.join(workspace, "memory", "MEMORY.md"), updatedAt: expect.any(Number) });
    expect((await readMemoryFile(workspace, "build-rules.md")).content).toContain("Verify changes.");
    for (const sessionId of ["first", "later"]) {
      const processor = createMemoryIndexProcessor(options);
      const message = await processor.process({ role: "user", parts: [{ type: "text", text: "hello" }] }, { scope: { sessionId } } as never);
      expect(JSON.stringify(message.parts)).toContain("build-rules [project]");
      expect(JSON.stringify(message.parts)).toContain("MEMORY [project]");
    }
  });

  it("keeps empty workspaces empty and never writes through an unconfigured root", async () => {
    const user = await root();
    expect(await listMemoryFiles(user)).toEqual([]);
    expect(await fs.readdir(user)).toEqual([]);
    const tools = createMemoryTools({ getUserRoot: () => user, getProjectRoot: () => "" });
    expect(await tools[0].execute({ id: "note", content: "Lasting note." }, {} as never)).toMatchObject({ isError: true });
    expect(await fs.readdir(user)).toEqual([]);
  });

  it("rejects traversal, reserved names, linked stores and oversized reads", async () => {
    const workspace = await root();
    const outside = await root();
    for (const name of ["../secret", "CON", "nul.txt", "note:stream", "a/b", "x\\y", "a\0b", "trailing."]) expect(validMemoryId(name)).toBe(false);
    await expect(resolveMemoryFile(workspace, "../note.md")).rejects.toThrow("Invalid memory file");
    await fs.symlink(outside, path.join(workspace, "memory"), process.platform === "win32" ? "junction" : "dir");
    await expect(listMemoryFiles(workspace)).rejects.toThrow("regular directory");
    await expect(writeEntry(workspace, { id: "note", scope: "project", tags: [], body: "outside" })).rejects.toThrow("regular directory");
    expect(await fs.readdir(outside)).toEqual([]);
    await fs.mkdir(path.join(outside, "memory"));
    await fs.writeFile(path.join(outside, "memory", "large.md"), Buffer.alloc(1_000_001, 65));
    expect(await listMemoryFiles(outside)).toHaveLength(1);
    await expect(readMemoryFile(outside, "large.md")).rejects.toThrow("1 MB");
  });
});
