// plugin-memory tests (batch 4B task 1): the dual-root memory store
// (write -> list -> read closed loop, user-root shadowing, malformed-entry
// degradation, id-escape rejection) and the three tool contracts
// (overwrite gating, persisted-args full persistence, permission resource
// shapes), plus the factory plugin mounting on a real kernel Context.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Context } from "@innocenceharness/kernel";
import { ToolsPlugin } from "@innocenceharness/harness-tools";
import {
  MEMORY_LIST_TOOL_NAME,
  MEMORY_READ_TOOL_NAME,
  MEMORY_WRITE_TOOL_NAME,
  createMemoryPlugin,
  createMemoryTools,
  listEntries,
  readEntry,
  writeEntry,
} from "../src";
import memoryDefault from "../src";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function tmpRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), "ic-memory-"));
  roots.push(root);
  return root;
}

const toolCtx = () =>
  ({
    workspaceRoot: "D:/work",
    signal: new AbortController().signal,
    log: () => {},
    scope: { sessionId: "s1", invocationId: "inv-1" },
  }) as never;

/** Hand-authored fixture: one raw file straight into <root>/memory/. */
function seedRaw(root: string, file: string, raw: string): void {
  mkdirSync(path.join(root, "memory"), { recursive: true });
  writeFileSync(path.join(root, "memory", file), raw, "utf8");
}

function makeTools(userRoot: string, projectRoot: string) {
  const tools = createMemoryTools({
    getUserRoot: () => userRoot,
    getProjectRoot: () => projectRoot,
  });
  const byName = new Map(tools.map((tool) => [tool.name, tool]));
  return {
    tools,
    write: byName.get(MEMORY_WRITE_TOOL_NAME)!,
    list: byName.get(MEMORY_LIST_TOOL_NAME)!,
    read: byName.get(MEMORY_READ_TOOL_NAME)!,
  };
}

describe("memory store", () => {
  it("write -> list -> read closed loop: frontmatter file, index row, body round-trip", async () => {
    const root = tmpRoot();
    await writeEntry(root, {
      id: "reply-style",
      scope: "project",
      tags: ["style", "writing"],
      body: "Keep answers short.\nPrefer bullet lists.",
    });
    const file = path.join(root, "memory", "reply-style.md");
    expect(existsSync(file)).toBe(true);
    const raw = readFileSync(file, "utf8");
    expect(raw.startsWith("---\n")).toBe(true);
    expect(raw).toContain("id: reply-style");
    expect(raw).toContain("scope: project");
    expect(raw).toContain("- style");
    expect(raw).toContain("updated:");
    expect(raw).toContain("Keep answers short.");

    const { entries, warnings } = await listEntries([root]);
    expect(warnings).toEqual([]);
    expect(entries).toEqual([
      {
        id: "reply-style",
        scope: "project",
        tags: ["style", "writing"],
        firstLine: "Keep answers short.",
      },
    ]);

    const entry = await readEntry([root], "reply-style");
    expect(entry).toBeDefined();
    expect(entry?.body).toBe("Keep answers short.\nPrefer bullet lists.");
    expect(entry?.scope).toBe("project");
    expect(entry?.tags).toEqual(["style", "writing"]);
  });

  it("dual-root shadowing: user root first, same id wins in list and read", async () => {
    const userRoot = tmpRoot();
    const projectRoot = tmpRoot();
    await writeEntry(projectRoot, {
      id: "build-cmd",
      scope: "project",
      tags: ["build"],
      body: "Project flavor of the build command.",
    });
    await writeEntry(userRoot, {
      id: "build-cmd",
      scope: "user",
      tags: ["build"],
      body: "User flavor of the build command.",
    });
    const merged = await listEntries([userRoot, projectRoot]);
    expect(merged.entries).toHaveLength(1);
    expect(merged.entries[0]).toMatchObject({ id: "build-cmd", scope: "user" });
    expect(merged.entries[0].firstLine).toBe("User flavor of the build command.");
    expect((await readEntry([userRoot, projectRoot], "build-cmd"))?.body).toBe(
      "User flavor of the build command.",
    );
    // 反向可见性：只看项目根时仍是项目条目（覆盖只发生在合并视图）。
    const projectOnly = await listEntries([projectRoot]);
    expect(projectOnly.entries[0].firstLine).toBe("Project flavor of the build command.");
  });

  it("malformed entries degrade to warnings, never fatal", async () => {
    const root = tmpRoot();
    await writeEntry(root, { id: "good-one", scope: "project", tags: [], body: "Fine entry." });
    seedRaw(root, "broken.md", "---\nid: broken\nscope: project\n"); // 残缺 frontmatter（无闭合围栏）
    seedRaw(root, "no-frontmatter.md", "Just plain text.");
    const { entries, warnings } = await listEntries([root]);
    expect(entries.map((entry) => entry.id)).toEqual(["good-one"]);
    expect(warnings).toHaveLength(2);
    expect(warnings.join("\n")).toContain("broken.md");
    expect(warnings.join("\n")).toContain("no-frontmatter.md");
    // 读路径同样未命中坏条目。
    expect(await readEntry([root], "broken")).toBeUndefined();
  });

  it("frontmatter id must match the file name; drift is a bad entry", async () => {
    const root = tmpRoot();
    seedRaw(
      root,
      "outer.md",
      "---\nid: inner\nscope: project\ntags: []\nupdated: 2026-01-01T00:00:00.000Z\n---\nBody.",
    );
    const { entries, warnings } = await listEntries([root]);
    expect(entries).toHaveLength(0);
    expect(warnings.join("\n")).toContain("outer.md");
  });

  it("id escape attempts are rejected before any path is built", async () => {
    const root = tmpRoot();
    for (const id of ["../evil", "a/b", "a\\b", ".hidden", "..", "", "C:", " spaced "]) {
      await expect(
        writeEntry(root, { id, scope: "project", tags: [], body: "x" }),
      ).rejects.toThrow(/id/);
    }
    expect(existsSync(path.join(root, "memory"))).toBe(false);
  });

  it("missing memory directory is an empty index, not a warning", async () => {
    const root = tmpRoot();
    const { entries, warnings } = await listEntries([root]);
    expect(entries).toEqual([]);
    expect(warnings).toEqual([]);
  });
});

describe("memory tools", () => {
  it("write -> list -> read through the tools with default project scope", async () => {
    const userRoot = tmpRoot();
    const projectRoot = tmpRoot();
    const { write, list, read } = makeTools(userRoot, projectRoot);

    const written = await write.execute(
      { id: "review-checklist", content: "Always run the focused tests first." },
      toolCtx(),
    );
    expect(written.isError).toBeFalsy();
    expect(existsSync(path.join(projectRoot, "memory", "review-checklist.md"))).toBe(true);
    expect(existsSync(path.join(userRoot, "memory"))).toBe(false);

    const listed = await list.execute({}, toolCtx());
    expect(listed.isError).toBeFalsy();
    expect(listed.content).toContain("review-checklist [project]");
    expect(listed.content).toContain("Always run the focused tests first.");
    expect(listed.content).not.toContain("run the focused tests first. Again"); // 只索引首行

    const loaded = await read.execute({ id: "review-checklist" }, toolCtx());
    expect(loaded.isError).toBeFalsy();
    expect(loaded.content).toBe("Always run the focused tests first.");
  });

  it("index line shape: tags render as #tag tokens, first line caps at 80 chars", async () => {
    const userRoot = tmpRoot();
    const projectRoot = tmpRoot();
    const { write, list } = makeTools(userRoot, projectRoot);
    const long = "X".repeat(200);
    await write.execute({ id: "long-entry", content: long, tags: ["alpha", "beta"] }, toolCtx());
    const listed = await list.execute({}, toolCtx());
    expect(listed.content).toContain("long-entry [project] #alpha #beta — ");
    const row = listed.content.split("\n").find((line) => line.startsWith("long-entry"))!;
    expect(row.endsWith("X".repeat(80))).toBe(true);
    expect(row).not.toContain("X".repeat(81));
  });

  it("user scope writes into the user root and the merged index shows [user]", async () => {
    const userRoot = tmpRoot();
    const projectRoot = tmpRoot();
    const { write, list } = makeTools(userRoot, projectRoot);
    await write.execute(
      { id: "editor", content: "Use the neutral editor config.", scope: "user", tags: ["tooling"] },
      toolCtx(),
    );
    expect(existsSync(path.join(userRoot, "memory", "editor.md"))).toBe(true);
    const listed = await list.execute({}, toolCtx());
    expect(listed.content).toContain("editor [user] #tooling");
  });

  it("overwrite gating: same-root replacement is rejected without overwrite, passes with it", async () => {
    const userRoot = tmpRoot();
    const projectRoot = tmpRoot();
    const { write, read } = makeTools(userRoot, projectRoot);
    await write.execute({ id: "deps", content: "Pin the lint plugin." }, toolCtx());

    const rejected = await write.execute({ id: "deps", content: "Pin the lint plugin twice." }, toolCtx());
    expect(rejected.isError).toBe(true);
    expect(rejected.content).toMatch(/overwrite/i);
    expect((await read.execute({ id: "deps" }, toolCtx())).content).toBe("Pin the lint plugin.");

    const replaced = await write.execute(
      { id: "deps", content: "Pin the lint plugin twice.", overwrite: true },
      toolCtx(),
    );
    expect(replaced.isError).toBeFalsy();
    expect((await read.execute({ id: "deps" }, toolCtx())).content).toBe("Pin the lint plugin twice.");
  });

  it("overwrite gating: shadowing another root's visible entry also requires overwrite", async () => {
    const userRoot = tmpRoot();
    const projectRoot = tmpRoot();
    const { write, list } = makeTools(userRoot, projectRoot);
    await write.execute({ id: "shared", content: "Project flavor." }, toolCtx());

    const shadow = await write.execute({ id: "shared", content: "User flavor.", scope: "user" }, toolCtx());
    expect(shadow.isError).toBe(true);
    expect(shadow.content).toMatch(/overwrite/i);

    const allowed = await write.execute(
      { id: "shared", content: "User flavor.", scope: "user", overwrite: true },
      toolCtx(),
    );
    expect(allowed.isError).toBeFalsy();
    const listed = await list.execute({}, toolCtx());
    expect(listed.content).toContain("shared [user]");
  });

  it("list appends merged-store warnings as a tail note", async () => {
    const userRoot = tmpRoot();
    const projectRoot = tmpRoot();
    seedRaw(projectRoot, "broken.md", "---\nid: broken\n"); // 残缺 frontmatter
    const { list } = makeTools(userRoot, projectRoot);
    const listed = await list.execute({}, toolCtx());
    expect(listed.isError).toBeFalsy();
    expect(listed.content).toMatch(/broken\.md/);
    expect(listed.content).toMatch(/notes?:/i);
  });

  it("list is honest about an empty index", async () => {
    const { list } = makeTools(tmpRoot(), tmpRoot());
    const listed = await list.execute({}, toolCtx());
    expect(listed.isError).toBeFalsy();
    expect(listed.content).toMatch(/no memory documents/i);
  });

  it("read miss returns an error pointing at the legitimate discovery path", async () => {
    const { read } = makeTools(tmpRoot(), tmpRoot());
    const missed = await read.execute({ id: "ghost" }, toolCtx());
    expect(missed.isError).toBe(true);
    expect(missed.content).toMatch(/memory_list/);
    expect(missed.content).not.toMatch(/ghost/); // 错误不回显入参值
  });

  it("id escapes rejected at validateArgs and fail-closed again at execute", async () => {
    const { write, read } = makeTools(tmpRoot(), tmpRoot());
    for (const id of ["../evil", "a/b", ".hidden", "", " spaced "]) {
      await expect(write.validateArgs?.({ id, content: "x" })).rejects.toThrow(/id/);
      const result = await write.execute({ id, content: "x" }, toolCtx());
      expect(result.isError).toBe(true);
    }
    await expect(read.validateArgs?.({ id: "a/b" })).rejects.toThrow(/id/);
    expect((await read.execute({ id: "a/b" }, toolCtx())).isError).toBe(true);
  });

  it("validateArgs: content required, tags/scope/overwrite typed", async () => {
    const { write } = makeTools(tmpRoot(), tmpRoot());
    await expect(write.validateArgs?.({ id: "a" })).rejects.toThrow(/content/);
    await expect(write.validateArgs?.({ id: "a", content: "  \n\t" })).rejects.toThrow(/content/);
    await expect(write.validateArgs?.({ id: "a", content: "x", scope: "team" })).rejects.toThrow(/scope/);
    await expect(write.validateArgs?.({ id: "a", content: "x", tags: "style" })).rejects.toThrow(/tags/);
    await expect(write.validateArgs?.({ id: "a", content: "x", tags: ["ok", 7] })).rejects.toThrow(/tags/);
    await expect(write.validateArgs?.({ id: "a", content: "x", tags: ["has space"] })).rejects.toThrow(/tags/);
    await expect(write.validateArgs?.({ id: "a", content: "x", overwrite: "yes" })).rejects.toThrow(/overwrite/);
    await expect(
      write.validateArgs?.({ id: "a", content: "x", tags: ["ok"], scope: "user", overwrite: false }),
    ).resolves.toBeUndefined();
  });

  it("persistArgs carries key fields plus the full memory body verbatim", () => {
    const { write, list, read } = makeTools(tmpRoot(), tmpRoot());
    const content = "SECRET-MEMORY-BODY-9812";
    const persisted = write.persistArgs({ id: "secret-note", content, tags: ["private"] });
    expect(persisted).toEqual({
      id: "secret-note",
      scope: "project",
      tags: ["private"],
      content,
    });
    // 完整原文持久化：正文全文进入持久化载荷。
    expect(JSON.stringify(persisted)).toContain(content);
    // scope 默认透出 project；显式 user 保持。
    expect(write.persistArgs({ id: "n2", content: "x", scope: "user" })).toMatchObject({ scope: "user" });
    // 非法 id 持久化为占位符，不回显原值。
    expect(write.persistArgs({ id: "../e", content: "x" })).toMatchObject({ id: "invalid" });
    expect(list.persistArgs({})).toEqual({});
    expect(read.persistArgs({ id: "some-id" })).toEqual({ id: "some-id" });
    expect(read.persistArgs({ id: "a/b" })).toEqual({ id: "invalid" });
  });

  it("permissionResource shapes: write (with overwrite suffix), list index, read id", () => {
    const { write, list, read } = makeTools(tmpRoot(), tmpRoot());
    expect(write.permissionResource({ id: "guide", content: "x" }, toolCtx())).toEqual({
      action: "write",
      kind: "memory",
      scope: "guide",
    });
    expect(
      write.permissionResource({ id: "guide", content: "x", overwrite: true }, toolCtx()),
    ).toEqual({ action: "write", kind: "memory", scope: "guide:overwrite" });
    expect(write.permissionResource({ id: "../e", content: "x" }, toolCtx())).toEqual({
      action: "write",
      kind: "memory",
      scope: "invalid",
    });
    expect(list.permissionResource({}, toolCtx())).toEqual({
      action: "read",
      kind: "memory",
      scope: "index",
    });
    expect(read.permissionResource({ id: "guide" }, toolCtx())).toEqual({
      action: "read",
      kind: "memory",
      scope: "guide",
    });
  });

  it("tool declarations: names, required args, side-effect classes, Chinese descriptions", () => {
    const { write, list, read } = makeTools(tmpRoot(), tmpRoot());
    expect(write.name).toBe("memory_write");
    expect(list.name).toBe("memory_list");
    expect(read.name).toBe("memory_read");
    expect(write.parameters).toMatchObject({
      type: "object",
      required: ["id", "content"],
      properties: {
        id: { type: "string" },
        content: { type: "string" },
        tags: { type: "array" },
        scope: { type: "string" },
        overwrite: { type: "boolean" },
      },
    });
    expect(read.parameters).toMatchObject({ type: "object", required: ["id"] });
    expect(list.parameters).toMatchObject({ type: "object" });
    expect(write.readOnly).toBe(false);
    expect(write.sideEffect).toBe("paths");
    expect(list.readOnly).toBe(true);
    expect(list.sideEffect).toBe("none");
    expect(read.readOnly).toBe(true);
    expect(read.sideEffect).toBe("none");
    for (const tool of [write, list, read]) {
      expect(tool.description).toMatch(/[\u4e00-\u9fff]/); // 本仓描述中文口径
      expect(typeof tool.persistArgs).toBe("function"); // 注册门要求（fail-closed SPI）
    }
  });
});

describe("memory plugin factory", () => {
  it("registers the three tools on a real kernel Context through the persistence gate", async () => {
    const userRoot = tmpRoot();
    const projectRoot = tmpRoot();
    const plugin = createMemoryPlugin({
      getUserRoot: () => userRoot,
      getProjectRoot: () => projectRoot,
    });
    expect(plugin.name).toBe("memory");
    const ctx = new Context();
    await ctx.plugin(ToolsPlugin);
    // 任务 2 起 apply 还注册首轮注入 processor：装配一个假会话服务承接。
    ctx.provide("session", { registerProcessor: () => {} });
    await ctx.plugin(plugin);
    expect(ctx.tools.get(MEMORY_WRITE_TOOL_NAME)?.name).toBe("memory_write");
    expect(ctx.tools.get(MEMORY_LIST_TOOL_NAME)?.name).toBe("memory_list");
    expect(ctx.tools.get(MEMORY_READ_TOOL_NAME)?.name).toBe("memory_read");
  });

  it("distribution default export is the factory itself", () => {
    expect(memoryDefault).toBe(createMemoryPlugin);
  });

  it("mounted tools write through the injected roots", async () => {
    const userRoot = tmpRoot();
    const projectRoot = tmpRoot();
    const ctx = new Context();
    await ctx.plugin(ToolsPlugin);
    ctx.provide("session", { registerProcessor: () => {} });
    await ctx.plugin(
      createMemoryPlugin({ getUserRoot: () => userRoot, getProjectRoot: () => projectRoot }),
    );
    const write = ctx.tools.get(MEMORY_WRITE_TOOL_NAME)!;
    const result = await write.execute({ id: "via-plugin", content: "Routed through the factory." }, toolCtx());
    expect(result.isError).toBeFalsy();
    expect(existsSync(path.join(projectRoot, "memory", "via-plugin.md"))).toBe(true);
  });
});

describe("text discipline", () => {
  it("LLM-facing outputs are English and banned-token free", async () => {
    const userRoot = tmpRoot();
    const projectRoot = tmpRoot();
    const { write, list, read } = makeTools(userRoot, projectRoot);
    await write.execute({ id: "t1", content: "First body." }, toolCtx());
    const outputs = [
      (await write.execute({ id: "t2", content: "Second body." }, toolCtx())).content,
      (await write.execute({ id: "t1", content: "Retry." }, toolCtx())).content,
      (await list.execute({}, toolCtx())).content,
      (await read.execute({ id: "t1" }, toolCtx())).content,
      (await read.execute({ id: "missing" }, toolCtx())).content,
    ];
    for (const output of outputs) {
      expect(output).not.toMatch(/[\u4e00-\u9fff]/);
      for (const re of [/Claude/i, /Anthropic/i, /OpenAI/i, /ChatGPT/i, /Codex/i, /Gemini/i]) {
        expect(output).not.toMatch(re);
      }
    }
  });
});
