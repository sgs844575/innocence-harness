import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Context } from "@innocenceharness/kernel";
import { LoggerPlugin } from "@innocenceharness/kernel-logger";
import { SkillsPlugin } from "@innocenceharness/harness-skills";
import {
  createSessionPlugin,
  textMessage,
} from "@innocenceharness/harness-session";
import type { Delta, Provider } from "@innocenceharness/harness-providers";
import { createTestSession } from "../../harness-electron/tests/helpers/testSession";
import { createSkillsPlugin, parseSkillMarkdown } from "../src";

let skillsDir: string;
beforeAll(async () => {
  skillsDir = await fs.mkdtemp(path.join(os.tmpdir(), "innocence-skills-"));
  await fs.mkdir(path.join(skillsDir, "review"), { recursive: true });
  await fs.writeFile(
    path.join(skillsDir, "review", "SKILL.md"),
    "---\nname: review\ndescription: 代码审查指南\n---\n\n审查正文：先看测试再看实现。",
    "utf8",
  );
  await fs.writeFile(
    path.join(skillsDir, "broken.md"),
    "没有 frontmatter 的文件应被忽略",
    "utf8",
  );
});
afterAll(async () => {
  await fs.rm(skillsDir, { recursive: true, force: true });
});

describe("parseSkillMarkdown", () => {
  it("parses frontmatter and body", () => {
    const parsed = parseSkillMarkdown(
      "---\nname: a\ndescription: b\n---\n\n正文",
    );
    expect(parsed).toEqual({ name: "a", description: "b", body: "正文" });
  });

  it("rejects files without complete frontmatter", () => {
    expect(parseSkillMarkdown("just text")).toBeNull();
    expect(parseSkillMarkdown("---\nname: a\n---\nbody")).toBeNull();
    expect(parseSkillMarkdown("---\ndescription: b\n---\nbody")).toBeNull();
  });
});

/** Mounts the plugin on a bare kernel context (logger + skills + session spines). */
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

describe("createSkillsPlugin", () => {
  it("registers parseable skills and skips the rest", async () => {
    const ctx = await mountSkills([skillsDir, path.join(skillsDir, "missing")]);
    expect(ctx.skills.all().map((s) => s.name)).toEqual(["review"]);
  });

  it("session injects the index and expands /skill input with the body", async () => {
    const systems: string[] = [];
    const provider: Provider = {
      id: "echo",
      async *chat(req): AsyncIterable<Delta> {
        systems.push(req.system);
        yield { type: "text", text: "ok" };
      },
    };
    const session = await createTestSession({
      plugins: [createSkillsPlugin({ dirs: [skillsDir] })],
      provider,
      workspaceRoot: "D:/tmp",
      permission: { mode: "auto", decider: { ask: async () => "deny" } },
    });
    await session.run("/review 请检查这段代码");
    expect(systems[0]).toContain("review: 代码审查指南");
    const firstUser = session.history[0].parts[0];
    expect(firstUser).toMatchObject({
      type: "text",
      text: expect.stringContaining("审查正文：先看测试再看实现"),
    });
  });

  it("expands only the targeted text part and preserves other parts and order", async () => {
    const provider: Provider = {
      id: "echo",
      async *chat(): AsyncIterable<Delta> {
        yield { type: "text", text: "ok" };
      },
    };
    const session = await createTestSession({
      plugins: [createSkillsPlugin({ dirs: [skillsDir] })],
      provider,
      workspaceRoot: "D:/tmp",
      permission: { mode: "auto", decider: { ask: async () => "deny" } },
    });

    await session.run({
      role: "user",
      parts: [
        { type: "text", text: "前言" },
        { type: "toolResult", toolCallId: "prior", content: "旧结果" },
        { type: "text", text: "/review 请检查" },
      ],
    });

    const parts = session.history[0].parts;
    expect(parts).toHaveLength(3);
    expect(parts[0]).toMatchObject({ type: "text", text: "前言" });
    expect(parts[1]).toMatchObject({ type: "toolResult", toolCallId: "prior", content: "旧结果" });
    const expanded = parts[2] as { type: string; text: string };
    expect(expanded.type).toBe("text");
    expect(expanded.text).toContain("审查正文：先看测试再看实现");
    expect(expanded.text).toContain("[用户输入]\n请检查");
    expect(expanded.text).not.toContain("/review");
  });
});

describe("skill-expansion processor", () => {
  it("registers the expansion processor ahead of conventionally-numbered processors", async () => {
    const ctx = await mountSkills([skillsDir]);
    const expansion = ctx.session
      .processors()
      .find((p) => p.name === "skill-expansion")!;
    expect(expansion).toBeDefined();
    expect(expansion.order).toBeLessThan(0);
    // End-to-end ordering probe: an order-0 processor must already see the
    // expanded text (the pre-migration session expanded before processors).
    ctx.session.registerProcessor({
      name: "order-probe",
      order: 0,
      async process(message) {
        const sawExpanded = message.parts.some(
          (p) => p.type === "text" && p.text.includes("审查正文：先看测试再看实现"),
        );
        return { ...message, parts: [...message.parts, { type: "text" as const, text: `expanded=${sawExpanded}` }] };
      },
    });
    const out = await ctx.session.processUserInput(textMessage("user", "/review x"));
    expect(out.parts.at(-1)).toMatchObject({ type: "text", text: "expanded=true" });
  });

  it("expands /name input through the processor pipeline and leaves unknown names untouched", async () => {
    const ctx = await mountSkills([skillsDir]);
    const expanded = await ctx.session.processUserInput(
      textMessage("user", "/review 请检查这段代码"),
    );
    expect(expanded.parts[0]).toMatchObject({
      type: "text",
      text: expect.stringContaining("审查正文：先看测试再看实现"),
    });
    expect((expanded.parts[0] as { text: string }).text).toContain("[用户输入]\n请检查这段代码");

    const untouched = await ctx.session.processUserInput(
      textMessage("user", "/nosuchskill 请检查"),
    );
    expect(untouched.parts[0]).toMatchObject({ type: "text", text: "/nosuchskill 请检查" });
  });

  it("passes messages through unchanged when no skills are registered", async () => {
    const ctx = await mountSkills([path.join(skillsDir, "missing")]);
    expect(ctx.skills.all()).toEqual([]);
    const out = await ctx.session.processUserInput(textMessage("user", "/review x"));
    expect(out).toEqual(textMessage("user", "/review x"));
  });
});

describe("skill re-mention note", () => {
  const noteText = (m: { parts: Array<{ type: string; text?: string }> }) =>
    m.parts.filter((p) => p.type === "text").map((p) => (p as { text: string }).text).join("\n");

  it("appends one note when a prose turn mentions a skill expanded earlier", async () => {
    const ctx = await mountSkills([skillsDir]);
    await ctx.session.processUserInput(textMessage("user", "/review 请检查"));
    const mention = await ctx.session.processUserInput(
      textMessage("user", "沿用 review 里约定的流程继续"),
    );
    const texts = noteText(mention);
    expect(texts).toContain("沿用 review 里约定的流程继续"); // 原文不改写
    expect(texts).toMatch(/<system-reminder>/);
    expect(texts).toMatch(/review/i);
    expect(texts).toMatch(/\/review/); // 提示以 /名称 重新调用
  });

  it("treats a fresh /name invocation as expansion, not a mention", async () => {
    const ctx = await mountSkills([skillsDir]);
    await ctx.session.processUserInput(textMessage("user", "/review 第一次"));
    const again = await ctx.session.processUserInput(textMessage("user", "/review 再来"));
    const texts = noteText(again);
    expect(texts).toContain("审查正文：先看测试再看实现。"); // 展开仍然发生
    expect(texts).not.toMatch(/<system-reminder>/);
  });

  it("stays silent when no recorded skill name appears in the turn", async () => {
    const ctx = await mountSkills([skillsDir]);
    await ctx.session.processUserInput(textMessage("user", "/review 请检查"));
    const other = await ctx.session.processUserInput(textMessage("user", "换个话题"));
    expect(noteText(other)).not.toMatch(/<system-reminder>/);
  });

  it("stays silent before any skill has been expanded", async () => {
    const ctx = await mountSkills([skillsDir]);
    const early = await ctx.session.processUserInput(
      textMessage("user", "聊聊 review 这个词"),
    );
    expect(noteText(early)).not.toMatch(/<system-reminder>/);
  });

  it("word boundaries: longer words containing the name do not trigger", async () => {
    const ctx = await mountSkills([skillsDir]);
    await ctx.session.processUserInput(textMessage("user", "/review 请检查"));
    const derived = await ctx.session.processUserInput(
      textMessage("user", "我 reviewed 了一遍，需要再 review 一轮"),
    );
    expect(noteText(derived)).toMatch(/<system-reminder>/); // 第二处是真提及
    const onlyDerived = await ctx.session.processUserInput(
      textMessage("user", "已经 reviewed 完毕"),
    );
    expect(noteText(onlyDerived)).not.toMatch(/<system-reminder>/);
  });

  it("the note is English and banned-token free", async () => {
    const ctx = await mountSkills([skillsDir]);
    await ctx.session.processUserInput(textMessage("user", "/review 请检查"));
    const mention = await ctx.session.processUserInput(textMessage("user", "按 review 办"));
    const note = noteText(mention).split("\n").find((line) => line.includes("system-reminder")) ?? "";
    const body = noteText(mention).slice(noteText(mention).indexOf("<system-reminder>"));
    expect(body).not.toMatch(/[\u4e00-\u9fff]/);
    for (const re of [/Claude/i, /Anthropic/i, /OpenAI/i, /ChatGPT/i, /Codex/i, /Gemini/i]) {
      expect(body).not.toMatch(re);
    }
    void note;
  });
});
