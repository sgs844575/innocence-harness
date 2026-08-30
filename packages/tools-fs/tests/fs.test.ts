import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Context } from "@innocenceharness/kernel";
import { ToolsPlugin } from "@innocenceharness/harness-tools";
import { createExecutionScope, sha256Hex, type ToolContext } from "@innocenceharness/harness-tools";
import { editTool } from "../src/edit";
import { createReadTool } from "../src/read";
import { createReadFileRegistry } from "../src/read-state";
import { globTool, grepTool } from "../src/search";
import { writeTool } from "../src/write";
import { resolveWithin } from "../src/paths";
import { FsPlugin } from "../src/index";

// M2 文件状态跟踪：直接单测用独立注册表实例，避免跨用例读取串扰。
const readTool = createReadTool(createReadFileRegistry());

/** Mounts the plugin on a bare kernel context (tools spine service only). */
async function mountFs(): Promise<Context> {
  const ctx = new Context();
  await ctx.plugin(ToolsPlugin);
  await ctx.plugin(FsPlugin);
  return ctx;
}

let root: string;
const ctx = (toolName = "Read"): ToolContext => ({
  workspaceRoot: root,
  signal: new AbortController().signal,
  log: () => {},
  scope: createExecutionScope(toolName),
});

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "innocence-fs-"));
  await fs.mkdir(path.join(root, "src", "nested"), { recursive: true });
  await fs.mkdir(path.join(root, "node_modules", "junk"), { recursive: true });
  await fs.writeFile(path.join(root, "src", "a.ts"), "line1\nline2\nline3\n", "utf8");
  await fs.writeFile(path.join(root, "src", "nested", "b.ts"), "const x = 42;\n", "utf8");
  await fs.writeFile(path.join(root, "src", "c.md"), "# doc\n", "utf8");
  await fs.writeFile(path.join(root, "node_modules", "junk", "x.ts"), "junk\n", "utf8");
  // 注记用 fixtures：空文件 / 越界小文件 / 4500 行大文件 / 命中超限搜索目标。
  await fs.writeFile(path.join(root, "empty.txt"), "", "utf8");
  await fs.writeFile(path.join(root, "tiny.txt"), "l1\nl2\nl3\n", "utf8");
  await fs.mkdir(path.join(root, "big"), { recursive: true });
  await fs.writeFile(
    path.join(root, "big", "large.txt"),
    `${Array.from({ length: 4500 }, (_, i) => `row ${i + 1}`).join("\n")}\n`,
    "utf8",
  );
  await fs.mkdir(path.join(root, "search"), { recursive: true });
  await fs.writeFile(
    path.join(root, "search", "many.txt"),
    Array.from({ length: 250 }, (_, i) => `needle ${i + 1}`).join("\n"),
    "utf8",
  );
});

afterAll(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe("resolveWithin", () => {
  it("resolves relative paths and rejects escapes", () => {
    expect(resolveWithin(root, "src/a.ts")).toBe(path.join(root, "src", "a.ts"));
    expect(resolveWithin(root, "./src/../src/a.ts")).toBe(path.join(root, "src", "a.ts"));
    expect(() => resolveWithin(root, "../outside.txt")).toThrow("越出工作区");
    expect(() => resolveWithin(root, path.join(root, "..", "x"))).toThrow("越出工作区");
  });

  it("accepts absolute paths inside the root", () => {
    expect(resolveWithin(root, path.join(root, "src", "a.ts"))).toBe(
      path.join(root, "src", "a.ts"),
    );
  });
});

describe("Read tool", () => {
  it("returns numbered lines with paging hint", async () => {
    const r = await readTool.execute({ path: "src/a.ts", limit: 2 }, ctx());
    expect(r.content).toContain("1\tline1");
    expect(r.content).toContain("2\tline2");
    expect(r.content).toContain("offset=3");
  });

  it("rejects directories and missing args", async () => {
    await expect(readTool.execute({ path: "src" }, ctx())).rejects.toThrow("目录");
    await expect(readTool.execute({}, ctx())).rejects.toThrow("path");
    await expect(readTool.execute({ path: "../x" }, ctx())).rejects.toThrow("越出工作区");
  });

  it("describes genuinely empty files and points to the write tool", async () => {
    const r = await readTool.execute({ path: "empty.txt" }, ctx());
    expect(r.content).toContain("[空文件");
    expect(r.content).toContain("写入");
  });

  it("distinguishes offset beyond EOF from an empty file", async () => {
    const r = await readTool.execute({ path: "tiny.txt", offset: 10 }, ctx());
    expect(r.content).toContain("越界");
    expect(r.content).toContain("offset=10");
    expect(r.content).toContain("无需继续读取");
    expect(r.content).not.toContain("[空文件");
  });

  it("truncation note discloses effective limit and sequential continuation offset", async () => {
    const r = await readTool.execute({ path: "big/large.txt", limit: 50 }, ctx());
    expect(r.content).toContain("limit=50");
    expect(r.content).toContain("offset=51");
    expect(r.content).toContain("顺序");
  });

  it("first-page read of a very large file appends chunked-reading guidance only there", async () => {
    const first = await readTool.execute({ path: "big/large.txt" }, ctx());
    expect(first.content).toContain("大文件");
    expect(first.content).toContain("文件路径:行号");
    const mid = await readTool.execute({ path: "big/large.txt", offset: 2001 }, ctx());
    expect(mid.content).not.toContain("大文件");
  });
});

describe("Write tool", () => {
  it("creates files with parent dirs", async () => {
    await writeTool.execute(
      { path: "docs/deep/new.txt", content: "hello" },
      ctx(),
    );
    const stat = await fs.stat(path.join(root, "docs", "deep", "new.txt"));
    expect(stat.isFile()).toBe(true);
  });
});

describe("Edit tool", () => {
  it("replaces a unique match and enforces uniqueness", async () => {
    await writeTool.execute({ path: "e.txt", content: "aa\nbb\naa\n" }, ctx());
    const ok = await editTool.execute(
      { path: "e.txt", old_string: "bb", new_string: "BB" },
      ctx(),
    );
    expect(ok.content).toContain("已替换 1 处");
    await expect(
      editTool.execute({ path: "e.txt", old_string: "aa", new_string: "x" }, ctx()),
    ).rejects.toThrow("不唯一");
    const all = await editTool.execute(
      { path: "e.txt", old_string: "aa", new_string: "AA", replace_all: true },
      ctx(),
    );
    expect(all.content).toContain("2 处");
    await expect(
      editTool.execute({ path: "e.txt", old_string: "zz", new_string: "x" }, ctx()),
    ).rejects.toThrow("不存在");
  });
});

describe("Glob / Grep tools", () => {
  it("glob finds by pattern and skips node_modules", async () => {
    const r = await globTool.execute({ pattern: "src/**/*.ts" }, ctx());
    expect(r.content).toContain("src/a.ts");
    expect(r.content).toContain("src/nested/b.ts");
    expect(r.content).not.toContain("junk");
    const none = await globTool.execute({ pattern: "**/*.zzz" }, ctx());
    expect(none.content).toContain("没有匹配");
  });

  it("grep matches with file:line and glob filter", async () => {
    const r = await grepTool.execute({ pattern: "42", glob: "*.ts" }, ctx());
    expect(r.content).toContain("src/nested/b.ts:1:");
    const filtered = await grepTool.execute({ pattern: "line", glob: "*.md" }, ctx());
    expect(filtered.content).toContain("没有匹配行");
  });

  it("grep discloses shown vs total matches when hits exceed the cap", async () => {
    const r = await grepTool.execute({ pattern: "needle", path: "search" }, ctx());
    expect(r.content).toContain("展示前 200 条");
    expect(r.content).toContain("共 250 条命中");
  });

  it("grep omits the disclosure when matches stay below the cap", async () => {
    const r = await grepTool.execute({ pattern: "42", glob: "*.ts" }, ctx());
    expect(r.content).toContain("src/nested/b.ts:1:");
    expect(r.content).not.toContain("命中已截断");
  });
});

describe("tools as plugin", () => {
  it("registers all five tools with sane metadata", async () => {
    const ctx = await mountFs();
    expect(ctx.tools.specs().map((s) => s.name).sort()).toEqual(["Edit", "Glob", "Grep", "Read", "Write"]);
    for (const spec of ctx.tools.specs()) {
      expect(spec.readOnly).toBeDefined();
      expect(spec.parameters.type).toBe("object");
    }
  });

  it("declares the coarse side-effect class of every tool", async () => {
    const ctx = await mountFs();
    expect(ctx.tools.get("Read")).toMatchObject({ sideEffect: "none" });
    expect(ctx.tools.get("Glob")).toMatchObject({ sideEffect: "none" });
    expect(ctx.tools.get("Grep")).toMatchObject({ sideEffect: "none" });
    expect(ctx.tools.get("Write")).toMatchObject({ sideEffect: "paths" });
    expect(ctx.tools.get("Edit")).toMatchObject({ sideEffect: "paths" });
  });
});

describe("persistence policy (permissionResource / persistArgs)", () => {
  const SECRET = "FS-SECRET-4b6d92aa";

  it("Write persists only path, content length and SHA-256", () => {
    const persisted = writeTool.persistArgs({ path: "src/a.ts", content: `body ${SECRET}` });
    expect(persisted).toMatchObject({
      path: "src/a.ts",
      contentLength: `body ${SECRET}`.length,
      contentSha256: sha256Hex(`body ${SECRET}`),
    });
    expect(JSON.stringify(persisted)).not.toContain(SECRET);
  });

  it("Edit persists only path and the new content's length/digest", () => {
    const persisted = editTool.persistArgs({
      path: "src/a.ts",
      old_string: `old ${SECRET}`,
      new_string: `new ${SECRET}`,
    });
    expect(persisted).toMatchObject({
      path: "src/a.ts",
      contentLength: `new ${SECRET}`.length,
      contentSha256: sha256Hex(`new ${SECRET}`),
    });
    expect(JSON.stringify(persisted)).not.toContain(SECRET);
  });

  it("path resources are canonical and workspace-relative", () => {
    const resource = writeTool.permissionResource(
      { path: path.join(root, "src", "a.ts"), content: "x" },
      ctx("Write"),
    );
    expect(resource).toEqual({ action: "write", kind: "path", scope: "src/a.ts" });

    const readResource = readTool.permissionResource({ path: "./src/../src/a.ts" }, ctx());
    expect(readResource).toEqual({ action: "read", kind: "path", scope: "src/a.ts" });

    const searchResource = grepTool.permissionResource({ pattern: "x", path: "src" }, ctx("Grep"));
    expect(searchResource).toEqual({ action: "read", kind: "search", scope: "src" });
  });

  it("validateArgs rejects malformed args before resources are derived", async () => {
    await expect(writeTool.validateArgs?.({ path: "a" })).rejects.toThrow("content");
    await expect(readTool.validateArgs?.({})).rejects.toThrow("path");
  });

  it("escaping paths are refused at the resource stage (fail-closed)", () => {
    expect(() =>
      writeTool.permissionResource({ path: "../outside.txt", content: "x" }, ctx("Write")),
    ).toThrow("越出工作区");
  });
});

describe("Read file-state tracking (M2)", () => {
  // root 由文件级 beforeAll 赋值，stateRoot 必须惰性到本 describe 的 beforeAll。
  let stateRoot: string;
  const ctxWithScope = (scope: ReturnType<typeof createExecutionScope>): ToolContext => ({
    workspaceRoot: root,
    signal: new AbortController().signal,
    log: () => {},
    scope,
  });

  beforeAll(async () => {
    stateRoot = path.join(root, "state");
    await fs.mkdir(stateRoot, { recursive: true });
  });

  it("first read carries no state note; unchanged re-read discloses repeat", async () => {
    await fs.writeFile(path.join(stateRoot, "u.txt"), "u1\nu2\n", "utf8");
    const read = createReadTool(createReadFileRegistry());
    const first = await read.execute({ path: "state/u.txt" }, ctx());
    expect(first.content).not.toContain("重复读取注记");
    expect(first.content).not.toContain("文件变更注记");
    const second = await read.execute({ path: "state/u.txt" }, ctx());
    expect(second.content).toContain("重复读取注记");
    expect(second.content).toContain("未变更");
    expect(second.content).not.toContain("文件变更注记");
  });

  it("disk change between reads swaps to the change note", async () => {
    await fs.writeFile(path.join(stateRoot, "c.txt"), "c1\n", "utf8");
    const read = createReadTool(createReadFileRegistry());
    await read.execute({ path: "state/c.txt" }, ctx());
    await fs.writeFile(path.join(stateRoot, "c.txt"), "c1\nchanged-line-added\n", "utf8");
    const again = await read.execute({ path: "state/c.txt" }, ctx());
    expect(again.content).toContain("文件变更注记");
    expect(again.content).toContain("以本次");
    expect(again.content).not.toContain("重复读取注记");
  });

  it("partial previous read is disclosed, then upgraded to the full-read wording", async () => {
    await fs.writeFile(
      path.join(stateRoot, "p.txt"),
      Array.from({ length: 10 }, (_, i) => `p${i + 1}`).join("\n") + "\n",
      "utf8",
    );
    const read = createReadTool(createReadFileRegistry());
    await read.execute({ path: "state/p.txt", limit: 3 }, ctx());
    const full = await read.execute({ path: "state/p.txt" }, ctx());
    expect(full.content).toContain("重复读取注记");
    expect(full.content).toContain("部分");
    const third = await read.execute({ path: "state/p.txt" }, ctx());
    expect(third.content).toContain("重复读取注记");
    expect(third.content).toContain("完整读过");
  });

  it("offset-overflow reads return without being recorded", async () => {
    await fs.writeFile(path.join(stateRoot, "o.txt"), "o1\n", "utf8");
    const read = createReadTool(createReadFileRegistry());
    await read.execute({ path: "state/o.txt", offset: 9 }, ctx());
    const again = await read.execute({ path: "state/o.txt", offset: 9 }, ctx());
    expect(again.content).toContain("越界");
    expect(again.content).not.toContain("重复读取注记");
  });

  it("subagent runs track independently of the parent and of each other", async () => {
    await fs.writeFile(path.join(stateRoot, "s.txt"), "s1\n", "utf8");
    const read = createReadTool(createReadFileRegistry());
    const parent = () =>
      ctxWithScope(createExecutionScope("Read", undefined, { sessionId: "sess-m2" }));
    const child = (inv: string) =>
      ctxWithScope(
        createExecutionScope("Read", undefined, { sessionId: "sess-m2", parentInvocationId: inv }),
      );
    await read.execute({ path: "state/s.txt" }, parent());
    // 子代理上下文里没有父会话的读取记录——不得误报“已读过”。
    const fromChildA = await read.execute({ path: "state/s.txt" }, child("inv-a"));
    expect(fromChildA.content).not.toContain("重复读取注记");
    const childAgain = await read.execute({ path: "state/s.txt" }, child("inv-a"));
    expect(childAgain.content).toContain("重复读取注记");
    // 兄弟子代理运行彼此独立。
    const fromChildB = await read.execute({ path: "state/s.txt" }, child("inv-b"));
    expect(fromChildB.content).not.toContain("重复读取注记");
  });

  it("newline-terminated file read to its exact limit still counts as full", async () => {
    await fs.writeFile(path.join(stateRoot, "e.txt"), "x1\nx2\n", "utf8");
    const read = createReadTool(createReadFileRegistry());
    await read.execute({ path: "state/e.txt", limit: 2 }, ctx());
    const again = await read.execute({ path: "state/e.txt" }, ctx());
    expect(again.content).toContain("完整读过");
    expect(again.content).not.toContain("部分读取");
  });

  it("state note appends after the truncation note", async () => {
    const read = createReadTool(createReadFileRegistry());
    await read.execute({ path: "big/large.txt", limit: 50 }, ctx());
    const again = await read.execute({ path: "big/large.txt", limit: 50 }, ctx());
    const truncationAt = again.content.indexOf("[已截断");
    expect(truncationAt).toBeGreaterThanOrEqual(0);
    expect(again.content.indexOf("[重复读取注记")).toBeGreaterThan(truncationAt);
  });

  it("FsPlugin mounts a fresh registry per session composition", async () => {
    await fs.writeFile(path.join(stateRoot, "m.txt"), "m1\n", "utf8");
    const ctxA = await mountFs();
    const ctxB = await mountFs();
    const toolA = ctxA.tools.get("Read");
    const toolB = ctxB.tools.get("Read");
    expect(toolA).toBeDefined();
    expect(toolB).toBeDefined();
    await toolA!.execute({ path: "state/m.txt" }, ctx());
    const viaB = await toolB!.execute({ path: "state/m.txt" }, ctx());
    expect(viaB.content).not.toContain("重复读取注记");
    const viaBAgain = await toolB!.execute({ path: "state/m.txt" }, ctx());
    expect(viaBAgain.content).toContain("重复读取注记");
  });
});
