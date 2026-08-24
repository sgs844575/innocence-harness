// 多根扫描语义（任务 4）：根序即优先序——前根同名技能优先，后根同名在
// 扫描层跳过（不依赖 skills 服务的重复注册异常）；单根行为与既有用例一致。
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Context } from "@innocenceharness/kernel";
import { LoggerPlugin } from "@innocenceharness/kernel-logger";
import { SkillsPlugin } from "@innocenceharness/harness-skills";
import { createSessionPlugin } from "@innocenceharness/harness-session";
import { createSkillsPlugin } from "../src";

let projectDir: string;
let userDir: string;
beforeAll(async () => {
  projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "innocence-skills-proj-"));
  userDir = await fs.mkdtemp(path.join(os.tmpdir(), "innocence-skills-user-"));
  await fs.mkdir(path.join(projectDir, "review"), { recursive: true });
  await fs.writeFile(
    path.join(projectDir, "review", "SKILL.md"),
    "---\nname: review\ndescription: 项目层技能\n---\n\n项目正文。",
    "utf8",
  );
  await fs.mkdir(path.join(projectDir, "deploy"), { recursive: true });
  await fs.writeFile(
    path.join(projectDir, "deploy", "SKILL.md"),
    "---\nname: deploy\ndescription: 仅项目层\n---\n\n部署正文。",
    "utf8",
  );
  // 用户层同名 review + 独有 lint。
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

async function mountSkills(dirs: string[]): Promise<Context> {
  const ctx = new Context();
  await ctx.plugin(LoggerPlugin);
  await ctx.plugin(SkillsPlugin);
  await ctx.plugin(
    createSessionPlugin({
      provider: { id: "bare", async *chat(): AsyncIterable<never> {} },
      sessionId: "sess-bare",
    }),
  );
  await ctx.plugin(createSkillsPlugin({ dirs }));
  return ctx;
}

describe("createSkillsPlugin multi-root", () => {
  it("前根同名技能优先，后根同名跳过（根序即优先序）", async () => {
    const ctx = await mountSkills([projectDir, userDir]);
    const review = ctx.skills.get("review");
    expect(review).toBeDefined();
    expect(review!.description).toBe("项目层技能");
  });

  it("各根独有技能全部注册（合并而非覆盖整个根）", async () => {
    const ctx = await mountSkills([projectDir, userDir]);
    expect(ctx.skills.all().map((s) => s.name).sort()).toEqual(["deploy", "lint", "review"]);
    expect(ctx.skills.get("lint")?.description).toBe("仅用户层");
  });

  it("用户根在前时用户层同名技能优先（序本身决定胜负，不绑定目录含义）", async () => {
    const ctx = await mountSkills([userDir, projectDir]);
    expect(ctx.skills.get("review")?.description).toBe("用户层技能");
  });

  it("单根行为不变（后根缺失目录照常跳过）", async () => {
    const ctx = await mountSkills([projectDir, path.join(projectDir, "missing")]);
    expect(ctx.skills.all().map((s) => s.name).sort()).toEqual(["deploy", "review"]);
  });
});
