import { describe, expect, it } from "vitest";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { listWorkspaceDir, listWorkspaceFiles, readWorkspaceFile } from "./workspaceFiles";

async function fixture(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "wsfiles-"));
  await mkdir(path.join(root, "src", "deep"), { recursive: true });
  await mkdir(path.join(root, "node_modules", "pkg"), { recursive: true });
  await mkdir(path.join(root, ".git"), { recursive: true });
  await writeFile(path.join(root, "b.ts"), "b", "utf8");
  await writeFile(path.join(root, "a.ts"), "a", "utf8");
  await writeFile(path.join(root, "src", "c.ts"), "c", "utf8");
  await writeFile(path.join(root, "src", "deep", "d.ts"), "d", "utf8");
  await writeFile(path.join(root, "node_modules", "pkg", "x.js"), "x", "utf8");
  await writeFile(path.join(root, ".git", "HEAD"), "ref", "utf8");
  await writeFile(path.join(root, "bin.dat"), Buffer.from([0x00, 0x01]));
  return root;
}

describe("listWorkspaceDir", () => {
  it("目录在前、按名排序，rel 逐级拼接", async () => {
    const root = await fixture();
    const top = await listWorkspaceDir(root, "");
    expect(top.map((entry) => entry.name)).toEqual([".git", "node_modules", "src", "a.ts", "b.ts", "bin.dat"]);
    expect(top[2]).toEqual({ name: "src", rel: "src", isDir: true });
    const inner = await listWorkspaceDir(root, "src");
    expect(inner.map((entry) => entry.rel)).toEqual(["src/deep", "src/c.ts"]);
  });

  it("拒绝越界相对路径", async () => {
    const root = await fixture();
    await expect(listWorkspaceDir(root, "../outside")).rejects.toThrow(/outside workspace/);
  });
});

describe("readWorkspaceFile", () => {
  it("读取文本内容；NUL 嗅探判定二进制不回内容", async () => {
    const root = await fixture();
    await expect(readWorkspaceFile(root, "a.ts")).resolves.toEqual({ content: "a", truncated: false, binary: false });
    await expect(readWorkspaceFile(root, "bin.dat")).resolves.toEqual({ content: "", truncated: false, binary: true });
    await expect(readWorkspaceFile(root, "../../etc/passwd")).rejects.toThrow(/outside workspace/);
  });
});

describe("listWorkspaceFiles", () => {
  it("跳过 .git/node_modules 并返回排序清单", async () => {
    const root = await fixture();
    await expect(listWorkspaceFiles(root)).resolves.toEqual(["a.ts", "b.ts", "bin.dat", "src/c.ts", "src/deep/d.ts"]);
  });
});
