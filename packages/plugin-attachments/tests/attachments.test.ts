// 附件摄入校验：纯校验函数矩阵 + 真会话管线（createTestSession 全链路，
// 含「技能展开不丢附件 parts」的规格回归）。
import { describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Delta, Provider } from "@innocenceharness/harness-providers";
import { createSkillsPlugin } from "@innocenceharness/plugin-skills";
import { createTestSession } from "../../harness-electron/tests/helpers/testSession";
import { attachmentValidationError, createAttachmentsPlugin } from "../src";

const ref = (n: string) => ({
  key: `sha256:${n.padStart(64, "0")}`,
  mediaType: "image/png",
  byteLength: 10,
});

const attachment = (name: string) => ({
  type: "attachment" as const,
  name,
  source: ref("1"),
  representations: [{ kind: "image" as const, content: ref("2") }],
});

const echoProvider: Provider = {
  id: "echo",
  async *chat(): AsyncIterable<Delta> {
    yield { type: "text", text: "ok" };
  },
};

describe("attachmentValidationError", () => {
  it("无附件与合法附件通过", () => {
    expect(attachmentValidationError({ role: "user", parts: [{ type: "text", text: "看" }] })).toBeNull();
    expect(
      attachmentValidationError({ role: "user", parts: [{ type: "text", text: "看" }, attachment("shot.png")] }),
    ).toBeNull();
  });

  it("超过单消息上限拒绝", () => {
    const parts = Array.from({ length: 11 }, () => attachment("a.png"));
    expect(attachmentValidationError({ role: "user", parts })).toContain("最多 10 个");
  });

  it("畸形引用与未知表示类型拒绝", () => {
    expect(
      attachmentValidationError({
        role: "user",
        parts: [{ type: "attachment", name: "x", source: { key: "md5:z", mediaType: "x", byteLength: 1 }, representations: [] }],
      }),
    ).toContain("引用不合法");
    expect(
      attachmentValidationError({
        role: "user",
        parts: [{
          type: "attachment",
          name: "x",
          source: ref("1"),
          representations: [{ kind: "audio" as never, content: ref("2") }],
        }],
      }),
    ).toContain("未知表示类型");
  });
});

describe("createAttachmentsPlugin（真会话管线）", () => {
  it("坏附件在处理器抛错拒绝；合法附件进历史且保留", async () => {
    const session = await createTestSession({
      plugins: [createAttachmentsPlugin()],
      provider: echoProvider,
      workspaceRoot: "D:/tmp",
      permission: { mode: "auto", decider: { ask: async () => "deny" } },
    });
    await expect(
      session.run({
        role: "user",
        parts: [{
          type: "attachment",
          name: "bad",
          source: { key: "nope", mediaType: "x", byteLength: 1 },
          representations: [],
        }],
      }),
    ).rejects.toThrow("引用不合法");

    await session.run({
      role: "user",
      parts: [{ type: "text", text: "看图" }, attachment("shot.png")],
    });
    const parts = session.history[0].parts;
    expect(parts.some((part) => part.type === "attachment" && part.name === "shot.png")).toBe(true);
  });

  it("技能展开与附件共存：/调用展开文本，附件 part 原样保留（规格 §13）", async () => {
    const skillsDir = await fs.mkdtemp(path.join(os.tmpdir(), "innocence-attach-skills-"));
    try {
      await fs.mkdir(path.join(skillsDir, "review"), { recursive: true });
      await fs.writeFile(
        path.join(skillsDir, "review", "SKILL.md"),
        "---\nname: review\ndescription: 审查\n---\n\n审查正文。",
        "utf8",
      );
      const session = await createTestSession({
        plugins: [createSkillsPlugin({ dirs: [skillsDir] }), createAttachmentsPlugin()],
        provider: echoProvider,
        workspaceRoot: "D:/tmp",
        permission: { mode: "auto", decider: { ask: async () => "deny" } },
      });
      await session.run({
        role: "user",
        parts: [{ type: "text", text: "/review 顺带看图" }, attachment("shot.png")],
      });
      const parts = session.history[0].parts;
      const expanded = parts.find((part) => part.type === "text") as { text: string };
      expect(expanded.text).toContain("审查正文。");
      expect(parts.some((part) => part.type === "attachment")).toBe(true);
    } finally {
      await fs.rm(skillsDir, { recursive: true, force: true });
    }
  });
});
