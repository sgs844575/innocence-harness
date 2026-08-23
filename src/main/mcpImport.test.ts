// MCP 标准格式导入单测（任务 5）：parse（合法/损坏/非对象/mcpServers 非对象）、
// 合并进 <root>/.innocence/config.json（新键追加/同名跳过/文件创建/已有键含
// permissions 保留/保序）、discover（.mcp.json 存在与否）。
// mkdtemp root fixture，不碰真实项目。
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { discoverMcpFile, importMcpServers, parseMcpImport, parseMcpJson } from "./mcpImport";

let root: string;
beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "innocence-mcp-import-"));
});
afterAll(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

async function readConfig(r: string = root): Promise<Record<string, unknown>> {
  return JSON.parse(await fs.readFile(path.join(r, ".innocence", "config.json"), "utf8"));
}

describe("parseMcpJson", () => {
  it("解析标准 { mcpServers: {...} }（command/args/env）", () => {
    const servers = parseMcpJson(
      JSON.stringify({
        mcpServers: {
          fs: { command: "npx", args: ["-y", "fs-server"], env: { K: "v" } },
          bare: { command: "run-me" },
        },
      }),
    );
    expect(servers).toEqual({
      fs: { command: "npx", args: ["-y", "fs-server"], env: { K: "v" } },
      bare: { command: "run-me" },
    });
  });

  it("损坏 JSON 抛错（由调用方降级）", () => {
    expect(() => parseMcpJson("{ not json")).toThrow();
  });

  it("非对象（数组/数字/null）抛错", () => {
    expect(() => parseMcpJson("[1]")).toThrow();
    expect(() => parseMcpJson("42")).toThrow();
    expect(() => parseMcpJson("null")).toThrow();
  });

  it("mcpServers 非对象或缺失抛错", () => {
    expect(() => parseMcpJson(JSON.stringify({ mcpServers: ["a"] }))).toThrow();
    expect(() => parseMcpJson(JSON.stringify({}))).toThrow();
  });
  it("mcpServers 条目缺少 command 或形状错误时跳过", () => {
    expect(parseMcpJson(JSON.stringify({
      mcpServers: {
        valid: { command: "run" },
        missing: { args: [] },
        empty: { command: "   " },
        scalar: "run",
        invalidArgs: { command: "run", args: [1] },
        invalidEnv: { command: "run", env: { PORT: 3000 } },
      },
    }))).toEqual({ valid: { command: "run" } });
  });

  it("导入结果保留畸形条目的 invalid-entry 状态", async () => {
    const parsed = parseMcpImport(JSON.stringify({
      mcpServers: { valid: { command: "run" }, invalid: { args: [] } },
    }));
    const result = await importMcpServers(parsed.servers, root, parsed.invalid);
    expect(result).toEqual({
      imported: ["valid"],
      skipped: [{ name: "invalid", reason: "invalid-entry" }],
    });
    await fs.rm(path.join(root, ".innocence"), { recursive: true, force: true });
  });
});

describe("importMcpServers", () => {
  it("拒绝把 config.json symlink 当作写入目标", async (ctx) => {
    const isolatedRoot = await fs.mkdtemp(path.join(os.tmpdir(), "innocence-mcp-symlink-"));
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), "innocence-mcp-outside-"));
    const configDir = path.join(isolatedRoot, ".innocence");
    const outsideConfig = path.join(outside, "config.json");
    const configPath = path.join(configDir, "config.json");
    try {
      await fs.mkdir(configDir, { recursive: true });
      await fs.writeFile(outsideConfig, JSON.stringify({ permissions: { allow: ["outside"] } }), "utf8");
      try {
        await fs.symlink(outsideConfig, configPath, "file");
      } catch (err) {
        if (["EPERM", "EACCES", "ENOTSUP"].includes((err as NodeJS.ErrnoException).code ?? "")) {
          ctx.skip();
          return;
        }
        throw err;
      }

      await expect(importMcpServers({ demo: { command: "run" } }, isolatedRoot)).rejects.toThrow(/symlink/i);
      expect(await fs.readFile(outsideConfig, "utf8")).toBe(
        JSON.stringify({ permissions: { allow: ["outside"] } }),
      );
      expect((await fs.lstat(configPath)).isSymbolicLink()).toBe(true);
    } finally {
      await fs.rm(isolatedRoot, { recursive: true, force: true });
      await fs.rm(outside, { recursive: true, force: true });
    }
  });

  it("mkdir 后父目录变为非目录时拒绝临时文件写入", async () => {
    const isolatedRoot = await fs.mkdtemp(path.join(os.tmpdir(), "innocence-mcp-parent-race-"));
    const configDir = path.join(isolatedRoot, ".innocence");
    const originalMkdir = fs.mkdir.bind(fs) as (directory: any, options?: any) => Promise<string | undefined>;
    const mkdirSpy = vi.spyOn(fs, "mkdir").mockImplementation(async (directory: any, options?: any) => {
      const created = await originalMkdir(directory, options);
      await fs.rm(configDir, { recursive: true, force: true });
      await fs.writeFile(configDir, "not a directory", "utf8");
      return created;
    });
    try {
      await expect(importMcpServers({ demo: { command: "run" } }, isolatedRoot)).rejects.toThrow(/non-directory/i);
    } finally {
      mkdirSpy.mockRestore();
      await fs.rm(isolatedRoot, { recursive: true, force: true });
    }
  });

  it("临时文件写入失败后清理临时文件且不留下目标配置", async () => {
    const isolatedRoot = await fs.mkdtemp(path.join(os.tmpdir(), "innocence-mcp-write-failure-"));
    const configDir = path.join(isolatedRoot, ".innocence");
    const configPath = path.join(configDir, "config.json");
    const originalWriteFile = fs.writeFile.bind(fs);
    const writePaths: string[] = [];
    const writeSpy = vi.spyOn(fs, "writeFile").mockImplementation(async (...args: any[]) => {
      const [file, data, encoding] = args;
      writePaths.push(String(file));
      await originalWriteFile(file, data, encoding);
      throw new Error("simulated temporary write failure");
    });
    try {
      await expect(importMcpServers({ demo: { command: "run" } }, isolatedRoot)).rejects.toThrow(
        "simulated temporary write failure",
      );
      expect(writePaths).toHaveLength(1);
      expect(path.dirname(writePaths[0])).toBe(await fs.realpath(configDir));
      expect(path.basename(writePaths[0])).not.toBe("config.json");
      await expect(fs.lstat(configPath)).rejects.toMatchObject({ code: "ENOENT" });
      expect(await fs.readdir(configDir)).toEqual([]);
    } finally {
      writeSpy.mockRestore();
      await fs.rm(isolatedRoot, { recursive: true, force: true });
    }
  });

  it("config 不存在时创建 {mcpServers:{}} 并写入新键", async () => {
    const result = await importMcpServers({ alpha: { command: "a" } }, root);
    expect(result).toEqual({ imported: ["alpha"], skipped: [] });
    const config = await readConfig();
    expect(config.mcpServers).toEqual({ alpha: { command: "a" } });
  });

  it("已有 config：新键追加、permissions 等其他键保留、已有键在前保序", async () => {
    // 前置：上一步留下 { mcpServers: { alpha }, } —— 现在加 permissions 与新键。
    await fs.writeFile(
      path.join(root, ".innocence", "config.json"),
      JSON.stringify({
        permissions: { allow: ["Read"] },
        mcpServers: { alpha: { command: "original" } },
      }),
      "utf8",
    );
    const result = await importMcpServers(
      {
        beta: { command: "b", args: ["--x"] },
        alpha: { command: "overwritten" },
      },
      root,
    );
    expect(result.imported).toEqual(["beta"]);
    expect(result.skipped).toEqual([{ name: "alpha", reason: "duplicate" }]);
    const config = await readConfig();
    expect(config.permissions).toEqual({ allow: ["Read"] }); // 不丢既有键
    expect(config.mcpServers).toEqual({
      alpha: { command: "original" }, // 同名跳过：原值不动
      beta: { command: "b", args: ["--x"] }, // 新键追加在后
    });
    expect(Object.keys(config.mcpServers as object)).toEqual(["alpha", "beta"]);
  });
});

describe("discoverMcpFile", () => {
  it(".mcp.json 存在时返回路径，不存在返回 null", async () => {
    expect(await discoverMcpFile(root)).toBe(null);
    const file = path.join(root, ".mcp.json");
    await fs.writeFile(file, JSON.stringify({ mcpServers: {} }), "utf8");
    expect(await discoverMcpFile(root)).toBe(file);
  });
});
