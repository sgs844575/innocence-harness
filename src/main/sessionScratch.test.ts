import { afterAll, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { ensureSessionScratchDir, removeSessionScratchDir, sessionScratchDir } from "./sessionScratch";

const homes: string[] = [];
afterAll(() => {
  for (const home of homes) {
    try {
      rmSync(home, { recursive: true, force: true });
    } catch {
      // 测试临时目录清理尽力而为。
    }
  }
});

describe("sessionScratchDir", () => {
  it("落在 <home>/.innocence/tmp/<sessionId>", () => {
    expect(sessionScratchDir("sess_abc123", path.join("C:", "Users", "u"))).toBe(
      path.join("C:", "Users", "u", ".innocence", "tmp", "sess_abc123"),
    );
  });

  it("拒绝可能越出 tmp 命名空间的 id", () => {
    expect(sessionScratchDir("../evil", "h")).toBeUndefined();
    expect(sessionScratchDir("a/b", "h")).toBeUndefined();
    expect(sessionScratchDir("..", "h")).toBeUndefined();
    expect(sessionScratchDir("", "h")).toBeUndefined();
    expect(sessionScratchDir("sess:1", "h")).toBeUndefined();
  });
});

describe("ensureSessionScratchDir", () => {
  it("递归创建目录且幂等", async () => {
    const home = mkdtempSync(path.join(os.tmpdir(), "scratch-home-"));
    homes.push(home);
    const dir = await ensureSessionScratchDir("sess_x1", home);
    expect(dir).toBe(path.join(home, ".innocence", "tmp", "sess_x1"));
    expect(existsSync(dir!)).toBe(true);
    await expect(ensureSessionScratchDir("sess_x1", home)).resolves.toBe(dir);
  });

  it("不安全 id 不触碰文件系统", async () => {
    const home = mkdtempSync(path.join(os.tmpdir(), "scratch-home-"));
    homes.push(home);
    await expect(ensureSessionScratchDir("../escape", home)).resolves.toBeUndefined();
    expect(existsSync(path.join(home, ".innocence"))).toBe(false);
  });
});

describe("removeSessionScratchDir", () => {
  it("递归移除该会话的暂存目录", async () => {
    const home = mkdtempSync(path.join(os.tmpdir(), "scratch-home-"));
    homes.push(home);
    const dir = await ensureSessionScratchDir("sess_gone", home);
    writeFileSync(path.join(dir!, "artifact.txt"), "x", "utf8");
    await removeSessionScratchDir("sess_gone", home);
    expect(existsSync(dir!)).toBe(false);
    // 同级会话目录不受影响
    const keep = await ensureSessionScratchDir("sess_keep", home);
    expect(existsSync(keep!)).toBe(true);
  });

  it("不安全或不存在的 id 静默无操作", async () => {
    const home = path.join(os.tmpdir(), "scratch-nope");
    await expect(removeSessionScratchDir("../evil", home)).resolves.toBeUndefined();
    await expect(removeSessionScratchDir("sess_missing", home)).resolves.toBeUndefined();
  });
});
