// 外部技能发现/导入单测：mkdtemp 家目录 fixture（正常/畸形/SKILL.md 缺失
// 跳过；import 复制/重名后缀/失败传播）。homedir 显式注入，不碰真实主目录。
import { afterAll, beforeAll, describe, expect, it } from "vitest";
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
});
