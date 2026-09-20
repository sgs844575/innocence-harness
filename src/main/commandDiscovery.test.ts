// 外部命令发现/导入单测：mkdtemp 家目录 fixture（正常 / 无 frontmatter 降级 /
// 坏 frontmatter 与非 *.md 跳过；import 单文件复制 / 重名后缀 / 越根拒绝）。
// homedir 显式注入，不碰真实主目录。
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  discoverExternalCommands,
  importCommand,
  userCommandsRoot,
  type DiscoveredCommand,
} from "./commandDiscovery";

let home: string;
beforeAll(async () => {
  home = await fs.mkdtemp(path.join(os.tmpdir(), "innocence-command-home-"));
  // external-a：正常 + 无 frontmatter 降级 + 坏 frontmatter 跳过 + 非 .md 跳过。
  const a = path.join(home, ".claude", "commands");
  await fs.mkdir(a, { recursive: true });
  await fs.writeFile(
    path.join(a, "review.md"),
    "---\nname: review\ndescription: 审查变更\n---\n\n审查正文。",
    "utf8",
  );
  await fs.writeFile(path.join(a, "plain.md"), "Just a plain prompt body.", "utf8");
  await fs.writeFile(path.join(a, "broken.md"), "---\nnot-yaml: [unclosed\n---\nbody", "utf8");
  await fs.writeFile(path.join(a, "notes.txt"), "not a command", "utf8");
  // external-b：正常。
  const b = path.join(home, ".agents", "commands");
  await fs.mkdir(b, { recursive: true });
  await fs.writeFile(
    path.join(b, "lint.md"),
    "---\nname: lint\ndescription: 检查\n---\n\n检查正文。",
    "utf8",
  );
});
afterAll(async () => {
  await fs.rm(home, { recursive: true, force: true });
});

function command(name: string, sourceFile: string): DiscoveredCommand {
  return { name, description: "d", sourceFile, origin: "external-a", imported: false };
}

describe("discoverExternalCommands", () => {
  it("收集各外部根的条目（含来源标识；无 frontmatter 降级为文件名）", async () => {
    const found = await discoverExternalCommands(home);
    expect(found.map((c) => [c.name, c.origin]).sort()).toEqual([
      ["lint", "external-b"],
      ["plain", "external-a"],
      ["review", "external-a"],
    ]);
    expect(found.find((c) => c.name === "plain")?.description).toBe("");
    expect(found.find((c) => c.name === "lint")?.description).toBe("检查");
  });

  it("坏 frontmatter / 非 .md / 缺失目录降级跳过，不抛错", async () => {
    const found = await discoverExternalCommands(home);
    expect(found.map((c) => c.name)).not.toContain("broken");
    expect(found.map((c) => c.name)).not.toContain("notes");
    const emptyHome = await fs.mkdtemp(path.join(os.tmpdir(), "innocence-command-empty-"));
    try {
      expect(await discoverExternalCommands(emptyHome)).toEqual([]);
    } finally {
      await fs.rm(emptyHome, { recursive: true, force: true });
    }
  });

  it("目标根已有同名文件时标记 imported", async () => {
    const root = userCommandsRoot(home);
    await fs.mkdir(root, { recursive: true });
    await fs.writeFile(path.join(root, "review.md"), "x", "utf8");
    const found = await discoverExternalCommands(home);
    expect(found.find((c) => c.name === "review")?.imported).toBe(true);
    expect(found.find((c) => c.name === "lint")?.imported).toBe(false);
    await fs.rm(root, { recursive: true, force: true });
  });
});

describe("importCommand", () => {
  it("复制单文件到目标根（UTF-8 内容完整），重名加 -imported 后缀", async () => {
    const target = await fs.mkdtemp(path.join(os.tmpdir(), "innocence-command-import-"));
    try {
      const source = path.join(home, ".claude", "commands", "review.md");
      await importCommand(command("review", source), target, home);
      await importCommand(command("review", source), target, home);
      expect((await fs.readdir(target)).sort()).toEqual(["review-imported.md", "review.md"]);
      expect(await fs.readFile(path.join(target, "review.md"), "utf8")).toContain("审查变更");
      expect(await fs.readFile(path.join(target, "review-imported.md"), "utf8")).toContain("审查变更");
    } finally {
      await fs.rm(target, { recursive: true, force: true });
    }
  });

  it("name 含路径分隔符、点前缀或盘符前缀时拒绝（防逃逸）", async () => {
    const target = await fs.mkdtemp(path.join(os.tmpdir(), "innocence-command-import-"));
    try {
      const source = path.join(home, ".claude", "commands", "review.md");
      for (const bad of ["..\\evil", "../evil", "a/b", ".hidden", "", "C:evil"]) {
        await expect(importCommand(command(bad, source), target, home)).rejects.toThrow("invalid command name");
      }
      expect(await fs.readdir(target)).toEqual([]);
    } finally {
      await fs.rm(target, { recursive: true, force: true });
    }
  });

  it("sourceFile 位于已知外部根之外时拒绝（不信任渲染层回传）", async () => {
    const target = await fs.mkdtemp(path.join(os.tmpdir(), "innocence-command-import-"));
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), "innocence-command-outside-"));
    try {
      const file = path.join(outside, "x.md");
      await fs.writeFile(file, "---\nname: x\ndescription: d\n---\n", "utf8");
      const traversal = path.join(home, ".claude", "commands", "..", "..", "..", "escape.md");
      for (const source of [file, traversal]) {
        await expect(importCommand(command("x", source), target, home)).rejects.toThrow(
          "command source outside known roots",
        );
      }
      expect(await fs.readdir(target)).toEqual([]);
    } finally {
      await fs.rm(target, { recursive: true, force: true });
      await fs.rm(outside, { recursive: true, force: true });
    }
  });

  it("根内 sourceFile 为 symlink 时拒绝导入", async (ctx) => {
    const target = await fs.mkdtemp(path.join(os.tmpdir(), "innocence-command-import-"));
    const link = path.join(home, ".claude", "commands", "linked.md");
    try {
      await fs.symlink(path.join(home, ".agents", "commands", "lint.md"), link);
    } catch (error) {
      if (["EPERM", "EACCES", "ENOTSUP"].includes((error as NodeJS.ErrnoException).code ?? "")) {
        ctx.skip();
        return;
      }
      throw error;
    }
    try {
      const found = await discoverExternalCommands(home);
      expect(found.map((c) => c.name)).not.toContain("linked");
      await expect(importCommand(command("linked", link), target, home)).rejects.toThrow(
        "command source outside known roots",
      );
      expect(await fs.readdir(target)).toEqual([]);
    } finally {
      await fs.rm(link, { force: true });
      await fs.rm(target, { recursive: true, force: true });
    }
  });
});
