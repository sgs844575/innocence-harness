import { describe, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { copyLogFiles } from "./exportLogs";

describe("copyLogFiles", () => {
  it("平铺复制日志目录下的全部文件并返回数量", async () => {
    const logs = await mkdtemp(path.join(os.tmpdir(), "logs-src-"));
    const target = await mkdtemp(path.join(os.tmpdir(), "logs-dst-"));
    await writeFile(path.join(logs, "main-1.log"), "one", "utf8");
    await writeFile(path.join(logs, "main-2.log"), "two", "utf8");
    await mkdir(path.join(logs, "subdir")); // 子目录不复制

    await expect(copyLogFiles(logs, target)).resolves.toBe(2);
    await expect(readFile(path.join(target, "main-1.log"), "utf8")).resolves.toBe("one");
    await expect(readFile(path.join(target, "main-2.log"), "utf8")).resolves.toBe("two");
  });

  it("日志目录不存在时返回 0", async () => {
    const target = await mkdtemp(path.join(os.tmpdir(), "logs-dst-"));
    await expect(copyLogFiles(path.join(os.tmpdir(), "logs-missing-nope"), target)).resolves.toBe(0);
  });
});
