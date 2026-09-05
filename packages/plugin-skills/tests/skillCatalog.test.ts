// 目录扫描出口（skills:list IPC 的数据面）：与 createSkillsPlugin 同扫描语义
// （子目录 SKILL.md / 裸 .md 条目、坏文件跳过、多根前根优先），只投影
// frontmatter，不加载正文、不触碰脊柱。
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { scanSkillCatalog } from "../src";

let projectDir: string;
let userDir: string;
beforeAll(async () => {
  projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "innocence-skillcat-proj-"));
  userDir = await fs.mkdtemp(path.join(os.tmpdir(), "innocence-skillcat-user-"));
  await fs.mkdir(path.join(projectDir, "review"), { recursive: true });
  await fs.writeFile(
    path.join(projectDir, "review", "SKILL.md"),
    "---\nname: review\ndescription: 项目层技能\n---\n\n项目正文。",
    "utf8",
  );
  // 裸 .md 条目形态（loadSkillFrom 的文件分支）。
  await fs.writeFile(
    path.join(projectDir, "deploy.md"),
    "---\nname: deploy\ndescription: 裸文件技能\n---\n\n部署正文。",
    "utf8",
  );
  // 坏 frontmatter：跳过不致命。
  await fs.writeFile(
    path.join(projectDir, "broken.md"),
    "no frontmatter at all",
    "utf8",
  );
  await fs.mkdir(path.join(userDir, "review"), { recursive: true });
  await fs.writeFile(
    path.join(userDir, "review", "SKILL.md"),
    "---\nname: review\ndescription: 用户层技能\n---\n\n用户正文。",
    "utf8",
  );
  await fs.mkdir(path.join(userDir, "lint"), { recursive: true });
  await fs.writeFile(
    path.join(userDir, "lint", "SKILL.md"),
    "---\nname: lint\ndescription: 仅用户层\n---\n\n检查正文。",
    "utf8",
  );
});
afterAll(async () => {
  await fs.rm(projectDir, { recursive: true, force: true });
  await fs.rm(userDir, { recursive: true, force: true });
});

describe("scanSkillCatalog", () => {
  it("多根合并 + 前根同名优先（与注册扫描同语义）", async () => {
    const catalog = await scanSkillCatalog([projectDir, userDir]);
    expect(catalog).toEqual([
      { name: "deploy", description: "裸文件技能" },
      { name: "review", description: "项目层技能" },
      { name: "lint", description: "仅用户层" },
    ]);
  });

  it("根序反转后同名胜负跟随根序", async () => {
    const catalog = await scanSkillCatalog([userDir, projectDir]);
    expect(catalog.find((entry) => entry.name === "review")?.description).toBe("用户层技能");
  });

  it("缺失目录照常跳过（无技能 = 空目录，不抛错）", async () => {
    const catalog = await scanSkillCatalog([path.join(projectDir, "missing")]);
    expect(catalog).toEqual([]);
  });
});
