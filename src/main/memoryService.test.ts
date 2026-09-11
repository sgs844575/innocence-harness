import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import memoryPlugin, { writeEntry } from "@innocenceharness/plugin-memory";
import { createMemoryService } from "./memoryService";

let storage: string;
afterEach(async () => { if (storage) await fs.rm(storage, { recursive: true, force: true }); });
async function setup() {
  storage = await fs.mkdtemp(path.join(os.tmpdir(), "memory-host-"));
  const first = path.join(storage, "project-a");
  const second = path.join(storage, "project-b");
  let user = path.join(storage, "user");
  const openFile = vi.fn(async () => {});
  const loadFiles = vi.fn(async () => memoryPlugin.files);
  const service = createMemoryService({ getWorkspaceRoots: () => [first, second, first, ""], getDataRoot: () => user, loadFiles, openFile });
  return { service, first, second, openFile, loadFiles, moveUser: (root: string) => { user = root; } };
}

describe("memory host adapter", () => {
  it("isolates workspaces, preserves filenames, and authorizes every open", async () => {
    const { service, first, second, openFile } = await setup();
    await writeEntry(path.join(first, ".innocence"), { id: "note", scope: "project", tags: [], body: "Project A." });
    await writeEntry(path.join(second, ".innocence"), { id: "note", scope: "project", tags: [], body: "Project B." });
    expect((await service.memoryWorkspaces()).map((workspace) => workspace.root)).toEqual([first, second]);
    expect((await service.memoryReadFile(first, "note.md")).content).toContain("Project A.");
    expect((await service.memoryReadFile(second, "note.md")).content).toContain("Project B.");
    await service.memoryOpenFile(first, "note.md", "editor");
    expect(openFile).toHaveBeenCalledWith(path.join(first, ".innocence", "memory", "note.md"), "editor");
    await expect(service.memoryOpenFile(first, "../note.md", "reveal")).rejects.toThrow();
    await expect(service.memoryFiles(path.join(storage, "unknown"))).rejects.toThrow("Unknown memory workspace");
    await expect(service.memoryFiles(undefined as never)).rejects.toThrow();
    expect(openFile).toHaveBeenCalledTimes(1);
  });

  it("reads the data root lazily and keeps an empty listing side effect free", async () => {
    const { service, moveUser } = await setup();
    expect(await service.memoryFiles(null)).toEqual([]);
    expect(await fs.readdir(storage)).toEqual([]);
    const relocated = path.join(storage, "relocated");
    await writeEntry(relocated, { id: "preferences", scope: "user", tags: [], body: "Lasting preference." });
    moveUser(relocated);
    expect((await service.memoryFiles(null)).map((file) => file.name)).toEqual(["preferences.md"]);
  });
});
