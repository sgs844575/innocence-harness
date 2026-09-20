import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createManagedCommand, importManagedCommand, listManagedCommands, removeManagedCommand } from "../src/commandManagement";
import { scanSkillCatalog } from "../src";
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((r) => fs.rm(r, { recursive: true, force: true }))); });
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "command-management-")); roots.push(root);
  const source = path.join(root, "source.md");
  await fs.writeFile(source, "---\nname: sample\ndescription: Sample command\n---\nDo the thing.", "utf8");
  return { root: path.join(root, "commands"), source };
}
describe("command management", () => {
  it("creates, lists, imports and removes flat *.md commands (degrading malformed files)", async () => {
    const { root, source } = await fixture();
    await createManagedCommand(root, { id: "review", description: "Review changes", body: "Review the diff." });
    const written = await fs.readFile(path.join(root, "review.md"), "utf8");
    expect(written).toContain("name: \"review\"");
    expect(written).toContain("Review the diff.");
    await importManagedCommand(root, source, "sample");
    await fs.writeFile(path.join(root, "broken.md"), "no frontmatter here", "utf8");
    await fs.writeFile(path.join(root, ".hidden.md"), "---\nname: hidden\ndescription: h\n---\n", "utf8");
    await fs.mkdir(path.join(root, "dir.md"));
    expect(await listManagedCommands(root)).toEqual([
      { id: "broken", name: "broken", description: "" },
      { id: "review", name: "review", description: "Review changes" },
      { id: "sample", name: "sample", description: "Sample command" },
    ]);
    // 与运行时目录扫描同一格式：创建的命令可被技能目录扫描直接调用。
    const catalog = (await scanSkillCatalog([root])).map((entry) => entry.name);
    expect(catalog).toContain("review");
    expect(catalog).toContain("sample");
    expect(catalog).not.toContain("broken");
    await expect(createManagedCommand(root, { id: "review", description: "dupe", body: "" })).rejects.toThrow();
    await expect(importManagedCommand(root, source, "sample")).rejects.toThrow();
    await expect(removeManagedCommand(root, "../source")).rejects.toThrow();
    await expect(removeManagedCommand(root, "dir")).rejects.toThrow();
    await removeManagedCommand(root, "review");
    expect((await listManagedCommands(root)).map((row) => row.id)).toEqual(["broken", "sample"]);
    expect(await fs.stat(source)).toBeTruthy();
  });
  it("rejects symlink sources and symlink targets", async (ctx) => {
    const { root, source } = await fixture();
    await createManagedCommand(root, { id: "review", description: "d", body: "b" });
    const sourceLink = path.join(root, "source-link.md");
    const targetLink = path.join(root, "linked.md");
    try {
      await fs.symlink(source, sourceLink);
      await fs.symlink(path.join(root, "review.md"), targetLink);
    } catch (error) {
      if (["EPERM", "EACCES", "ENOTSUP"].includes((error as NodeJS.ErrnoException).code ?? "")) { ctx.skip(); return; }
      throw error;
    }
    await expect(importManagedCommand(root, sourceLink, "via-link")).rejects.toThrow("Invalid command source");
    await expect(removeManagedCommand(root, "linked")).rejects.toThrow("not an owned file");
    expect((await listManagedCommands(root)).map((row) => row.id)).toEqual(["review"]);
  });
});
