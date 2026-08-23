// 外部技能发现/导入单测：mkdtemp 家目录 fixture（正常/畸形/SKILL.md 缺失
// 跳过；import 复制/重名后缀/失败传播）。homedir 显式注入，不碰真实主目录。
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  discoverExternalSkills,
  importSkill,
  userSkillsRoot,
  type DiscoveredSkill,
} from "./skillDiscovery";

let home: string;
beforeAll(async () => {
  home = await fs.mkdtemp(path.join(os.tmpdir(), "innocence-discover-home-"));
  // external-a：正常 + 畸形（无 description）+ 非目录条目。
  const a = path.join(home, ".claude", "skills");
  await fs.mkdir(path.join(a, "review"), { recursive: true });
  await fs.writeFile(
    path.join(a, "review", "SKILL.md"),
    "---\nname: review\ndescription: 审查指南\n---\n\n正文。",
    "utf8",
  );
  await fs.mkdir(path.join(a, "malformed"), { recursive: true });
  await fs.writeFile(
    path.join(a, "malformed", "SKILL.md"),
    "---\nname: malformed\n---\n正文",
    "utf8",
  );
  await fs.writeFile(path.join(a, "loose.md"), "not a directory", "utf8");
  // external-b：正常 + 缺 SKILL.md 的目录。
  const b = path.join(home, ".agents", "skills");
  await fs.mkdir(path.join(b, "lint"), { recursive: true });
  await fs.writeFile(
    path.join(b, "lint", "SKILL.md"),
    "---\nname: lint\ndescription: 检查\n---\n\n正文。",
    "utf8",
  );
  await fs.mkdir(path.join(b, "empty"), { recursive: true });
});
afterAll(async () => {
  await fs.rm(home, { recursive: true, force: true });
});

function skill(name: string, sourceDir: string): DiscoveredSkill {
  return { name, description: "d", sourceDir, origin: "external-a", imported: false };
}

describe("discoverExternalSkills", () => {
  it("收集各外部根的可解析条目（含来源标识）", async () => {
    const found = await discoverExternalSkills(home);
    expect(found.map((s) => [s.name, s.origin]).sort()).toEqual([
      ["lint", "external-b"],
      ["review", "external-a"],
    ]);
    expect(found.find((s) => s.name === "lint")?.description).toBe("检查");
  });

  it("畸形/缺 SKILL.md/非目录条目降级跳过，不抛错", async () => {
    const found = await discoverExternalSkills(home);
    expect(found.map((s) => s.name)).not.toContain("malformed");
    expect(found.map((s) => s.name)).not.toContain("empty");
  });

  it("目标根已有同名时标记 imported", async () => {
    await fs.mkdir(path.join(userSkillsRoot(home), "review"), { recursive: true });
    const found = await discoverExternalSkills(home);
    const review = found.find((s) => s.name === "review");
    expect(review?.imported).toBe(true);
    const lint = found.find((s) => s.name === "lint");
    expect(lint?.imported).toBe(false);
  });

  it("外部根缺失目录照常返回空/其余结果", async () => {
    const emptyHome = await fs.mkdtemp(path.join(os.tmpdir(), "innocence-discover-empty-"));
    try {
      expect(await discoverExternalSkills(emptyHome)).toEqual([]);
    } finally {
      await fs.rm(emptyHome, { recursive: true, force: true });
    }
  });
  it("根内指向根外的顶层目录 symlink 不被发现", async (ctx) => {
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), "innocence-discover-outside-"));
    const link = path.join(home, ".claude", "skills", "linked-outside");
    try {
      await fs.writeFile(
        path.join(outside, "SKILL.md"),
        "---\nname: linked-outside\ndescription: d\n---\n",
        "utf8",
      );
      try {
        await fs.symlink(outside, link, "junction");
      } catch (err) {
        if (["EPERM", "EACCES", "ENOTSUP"].includes((err as NodeJS.ErrnoException).code ?? "")) {
          ctx.skip();
          return;
        }
        throw err;
      }
      const found = await discoverExternalSkills(home);
      expect(found.map((s) => s.name)).not.toContain("linked-outside");
    } finally {
      await fs.rm(link, { recursive: true, force: true });
      await fs.rm(outside, { recursive: true, force: true });
    }
  });
});

describe("importSkill", () => {
  it("复制目录到目标根（递归含子文件，UTF-8 内容完整）", async () => {
    const target = await fs.mkdtemp(path.join(os.tmpdir(), "innocence-import-"));
    try {
      await importSkill(
        skill("review", path.join(home, ".claude", "skills", "review")),
        target,
        home,
      );
      const copied = await fs.readFile(path.join(target, "review", "SKILL.md"), "utf8");
      expect(copied).toContain("审查指南");
    } finally {
      await fs.rm(target, { recursive: true, force: true });
    }
  });

  it("重名导入加 -imported 后缀", async () => {
    const target = await fs.mkdtemp(path.join(os.tmpdir(), "innocence-import-"));
    try {
      await importSkill(
        skill("review", path.join(home, ".claude", "skills", "review")),
        target,
        home,
      );
      await importSkill(
        skill("review", path.join(home, ".claude", "skills", "review")),
        target,
        home,
      );
      const entries = await fs.readdir(target);
      expect(entries.sort()).toEqual(["review", "review-imported"]);
    } finally {
      await fs.rm(target, { recursive: true, force: true });
    }
  });

  it("源目录不存在时失败抛错（由调用方提示）", async () => {
    const target = await fs.mkdtemp(path.join(os.tmpdir(), "innocence-import-"));
    try {
      await expect(
        importSkill(skill("gone", path.join(home, "no-such-dir")), target, home),
      ).rejects.toThrow();
    } finally {
      await fs.rm(target, { recursive: true, force: true });
    }
  });

  it("name 含路径分隔符、点前缀或盘符前缀时拒绝（防逃逸）", async () => {
    const target = await fs.mkdtemp(path.join(os.tmpdir(), "innocence-import-"));
    try {
      const source = path.join(home, ".claude", "skills", "review");
      for (const bad of ["..\\evil", "../evil", "a/b", ".hidden", "", "C:evil"]) {
        await expect(importSkill(skill(bad, source), target, home)).rejects.toThrow(
          "invalid skill name",
        );
      }
      expect(await fs.readdir(target)).toEqual([]);
    } finally {
      await fs.rm(target, { recursive: true, force: true });
    }
  });

  it("sourceDir 位于已知外部根之外时拒绝（不信任渲染层回传）", async () => {
    const target = await fs.mkdtemp(path.join(os.tmpdir(), "innocence-import-"));
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), "innocence-outside-"));
    try {
      await fs.writeFile(path.join(outside, "SKILL.md"), "---\nname: x\ndescription: d\n---\n", "utf8");
      // 逃逸尝试：根内前缀 + .. 上跳
      const traversal = path.join(home, ".claude", "skills", "..", "..", "..");
      for (const dir of [outside, traversal]) {
        await expect(importSkill(skill("review", dir), target, home)).rejects.toThrow(
          "skill source outside known roots",
        );
      }
      expect(await fs.readdir(target)).toEqual([]);
    } finally {
      await fs.rm(target, { recursive: true, force: true });
      await fs.rm(outside, { recursive: true, force: true });
    }
  });

  it("根内 sourceDir symlink 指向根外时拒绝导入", async (ctx) => {
    const linkHome = await fs.mkdtemp(path.join(os.tmpdir(), "innocence-import-link-home-"));
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), "innocence-import-link-outside-"));
    const target = await fs.mkdtemp(path.join(os.tmpdir(), "innocence-import-"));
    const sourceRoot = path.join(linkHome, ".claude", "skills");
    const link = path.join(sourceRoot, "linked-outside");
    try {
      await fs.mkdir(sourceRoot, { recursive: true });
      await fs.writeFile(
        path.join(outside, "SKILL.md"),
        "---\nname: linked-outside\ndescription: d\n---\n",
        "utf8",
      );
      try {
        await fs.symlink(outside, link, "junction");
      } catch (err) {
        if (["EPERM", "EACCES", "ENOTSUP"].includes((err as NodeJS.ErrnoException).code ?? "")) {
          ctx.skip();
          return;
        }
        throw err;
      }
      await expect(
        importSkill(skill("linked-outside", link), target, linkHome),
      ).rejects.toThrow("skill source outside known roots");
      expect(await fs.readdir(target)).toEqual([]);
    } finally {
      await fs.rm(linkHome, { recursive: true, force: true });
      await fs.rm(outside, { recursive: true, force: true });
      await fs.rm(target, { recursive: true, force: true });
    }
  });

  it("复制前入口变为根外 symlink 时拒绝导入", async (ctx) => {
    const linkHome = await fs.mkdtemp(path.join(os.tmpdir(), "innocence-import-toctou-home-"));
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), "innocence-import-toctou-outside-"));
    const target = await fs.mkdtemp(path.join(os.tmpdir(), "innocence-import-toctou-target-"));
    const sourceRoot = path.join(linkHome, ".claude", "skills");
    const source = path.join(sourceRoot, "replace-me");
    const targetPath = path.join(target, "replace-me");
    const originalStat = fs.stat.bind(fs);
    let replaced = false;
    const statSpy = vi.spyOn(fs, "stat").mockImplementation(async (file, ...args) => {
      if (!replaced && String(file) === targetPath) {
        replaced = true;
        await fs.rm(source, { recursive: true, force: true });
        await fs.symlink(outside, source, "junction");
      }
      return originalStat(file, ...args);
    });
    try {
      await fs.mkdir(source, { recursive: true });
      await fs.writeFile(path.join(source, "SKILL.md"), "---\nname: replace-me\ndescription: d\n---\n", "utf8");
      await fs.writeFile(path.join(outside, "SKILL.md"), "---\nname: outside\ndescription: outside\n---\n", "utf8");
      await expect(importSkill(skill("replace-me", source), target, linkHome)).rejects.toThrow(
        "skill source outside known roots",
      );
      expect(await fs.readdir(target)).toEqual([]);
    } catch (err) {
      if (["EPERM", "EACCES", "ENOTSUP"].includes((err as NodeJS.ErrnoException).code ?? "")) {
        ctx.skip();
        return;
      }
      throw err;
    } finally {
      statSpy.mockRestore();
      await fs.rm(linkHome, { recursive: true, force: true });
      await fs.rm(outside, { recursive: true, force: true });
      await fs.rm(target, { recursive: true, force: true });
    }
  });

  it("目录/文件 symlink 条目跳过，不递归不复制（防环）", async (ctx) => {
    const linkHome = await fs.mkdtemp(path.join(os.tmpdir(), "innocence-link-home-"));
    const target = await fs.mkdtemp(path.join(os.tmpdir(), "innocence-import-"));
    try {
      const src = path.join(linkHome, ".claude", "skills", "linked");
      await fs.mkdir(path.join(src, "sub"), { recursive: true });
      await fs.writeFile(path.join(src, "SKILL.md"), "---\nname: linked\ndescription: d\n---\n", "utf8");
      await fs.writeFile(path.join(src, "real.txt"), "real", "utf8");
      // 目录自环 symlink + 文件 symlink（Windows 无特权时创建失败则跳过本用例）
      try {
        await fs.symlink(src, path.join(src, "sub", "cycle"));
        await fs.symlink(path.join(src, "real.txt"), path.join(src, "file-link.txt"));
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "EPERM") {
          ctx.skip();
          return;
        }
        throw err;
      }
      await importSkill(skill("linked", src), target, linkHome);
      expect(await fs.readFile(path.join(target, "linked", "real.txt"), "utf8")).toBe("real");
      expect(fs.readdir(path.join(target, "linked", "sub"))).resolves.toEqual([]);
      await expect(fs.lstat(path.join(target, "linked", "file-link.txt"))).rejects.toThrow();
    } finally {
      await fs.rm(linkHome, { recursive: true, force: true });
      await fs.rm(target, { recursive: true, force: true });
    }
  });
});
