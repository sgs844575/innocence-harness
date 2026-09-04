// 数据存储位置：目标守卫、应用数据项复制、指针写入与 setDataRoot 编排。
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const { appMock } = vi.hoisted(() => ({
  appMock: {
    relaunch: vi.fn(),
    exit: vi.fn(),
  },
}));

vi.mock("electron", () => ({
  app: {
    relaunch: appMock.relaunch,
    exit: appMock.exit,
  },
}));

import {
  copyAppDataEntries,
  guardDataRootTarget,
  setDataRoot,
  writeDataRootPointer,
} from "./dataRoot";
import { initAppDataRoot } from "./appDataRoot";
import { defaultDataRoot, readDataRootPointer } from "./userDataRoot";

const tempRoots: string[] = [];

function tempRoot(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "dataroot-"));
  tempRoots.push(dir);
  return dir;
}

afterEach(() => {
  vi.useRealTimers();
  // 数据根测试缝复位：不把已删除的临时根留给同 worker 的其他测试。
  initAppDataRoot(defaultDataRoot());
  while (tempRoots.length > 0) rmSync(tempRoots.pop()!, { recursive: true, force: true });
  vi.clearAllMocks();
});

describe("guardDataRootTarget", () => {
  it("空值/非字符串拒绝", () => {
    expect(guardDataRootTarget("", "/data").ok).toBe(false);
    expect(guardDataRootTarget("   ", "/data").ok).toBe(false);
    expect(guardDataRootTarget(undefined, "/data").ok).toBe(false);
    expect(guardDataRootTarget(42, "/data").ok).toBe(false);
  });

  it("目标即当前根 / 互相包含都拒绝", () => {
    const base = tempRoot();
    const current = path.join(base, ".innocence");
    // target = parent/.innocence == current
    expect(guardDataRootTarget(base, current)).toMatchObject({ ok: false });
    // target 在当前根之内
    expect(guardDataRootTarget(current, current)).toMatchObject({ ok: false });
    // 当前根在 target 之内
    const parent = path.join(base, "p");
    mkdirSync(parent, { recursive: true });
    const deeperCurrent = path.join(parent, ".innocence", "deeper");
    expect(guardDataRootTarget(parent, deeperCurrent)).toMatchObject({ ok: false });
  });

  it("父目录不存在 / 不是目录都拒绝", () => {
    const base = tempRoot();
    const current = path.join(tempRoot(), ".innocence");
    expect(guardDataRootTarget(path.join(base, "missing"), current)).toMatchObject({
      ok: false,
      error: "directory does not exist",
    });
    const file = path.join(base, "a-file");
    writeFileSync(file, "x", "utf8");
    expect(guardDataRootTarget(file, current)).toMatchObject({ ok: false, error: "not a directory" });
  });

  it("合法父目录 → target = parent/.innocence", () => {
    const parent = tempRoot();
    const current = path.join(tempRoot(), ".innocence");
    const guard = guardDataRootTarget(parent, current);
    expect(guard).toEqual({ ok: true, target: path.join(path.resolve(parent), ".innocence") });
  });
});

describe("copyAppDataEntries", () => {
  it("复制存在的应用数据项（含 sessions/ 树），缺项跳过", async () => {
    const source = path.join(tempRoot(), ".innocence");
    const parent = tempRoot();
    const target = path.join(parent, ".innocence");
    mkdirSync(path.join(source, "sessions", "2026", "09", "04"), { recursive: true });
    writeFileSync(path.join(source, "sessions.json"), "[]", "utf8");
    writeFileSync(path.join(source, "sessions", "2026", "09", "04", "s1.jsonl"), "{}\n", "utf8");
    // 非清单项不复制。
    writeFileSync(path.join(source, "Cookies"), "jar", "utf8");

    await copyAppDataEntries(source, target);

    expect(readFileSync(path.join(target, "sessions.json"), "utf8")).toBe("[]");
    expect(readFileSync(path.join(target, "sessions", "2026", "09", "04", "s1.jsonl"), "utf8")).toBe("{}\n");
    expect(existsSync(path.join(target, "Cookies"))).toBe(false);
    // 原根保持不动。
    expect(existsSync(path.join(source, "sessions.json"))).toBe(true);
  });

  it("复制失败抛错（部分复制可接受，调用方不重启）", async () => {
    const source = path.join(tempRoot(), ".innocence");
    mkdirSync(source, { recursive: true });
    writeFileSync(path.join(source, "sessions.json"), "[]", "utf8");
    // 目标根位置被文件占用 → cp 必失败。
    const blocker = path.join(tempRoot(), "blocker");
    writeFileSync(blocker, "x", "utf8");
    await expect(copyAppDataEntries(source, path.join(blocker, ".innocence"))).rejects.toThrow();
  });
});

describe("setDataRoot", () => {
  it("守卫失败 → ok:false 且不重启", async () => {
    initAppDataRoot(path.join(tempRoot(), ".innocence"));
    const result = await setDataRoot("");
    expect(result.ok).toBe(false);
    expect(appMock.relaunch).not.toHaveBeenCalled();
    expect(appMock.exit).not.toHaveBeenCalled();
  });

  it("成功路径：复制 + 写指针 + 300ms 后 relaunch/exit", async () => {
    vi.useFakeTimers();
    const source = path.join(tempRoot(), ".innocence");
    mkdirSync(source, { recursive: true });
    writeFileSync(path.join(source, "sessions.json"), "[]", "utf8");
    initAppDataRoot(source);
    const parent = tempRoot();
    const pointerFile = path.join(tempRoot(), "data-root.json");

    const result = await setDataRoot(parent, { pointerFile });
    expect(result).toEqual({ ok: true });

    const target = path.join(path.resolve(parent), ".innocence");
    expect(readFileSync(path.join(target, "sessions.json"), "utf8")).toBe("[]");
    // 指针重启解析可回读。
    expect(readDataRootPointer(pointerFile)).toBe(target);

    expect(appMock.relaunch).not.toHaveBeenCalled();
    vi.advanceTimersByTime(300);
    expect(appMock.relaunch).toHaveBeenCalledTimes(1);
    expect(appMock.exit).toHaveBeenCalledWith(0);
  });

  it("复制失败 → ok:false 且不重启、不写指针", async () => {
    const source = path.join(tempRoot(), ".innocence");
    mkdirSync(source, { recursive: true });
    writeFileSync(path.join(source, "sessions.json"), "[]", "utf8");
    initAppDataRoot(source);
    // 目标根位置被同名文件占用 → 复制必失败（守卫仍通过：父目录合法）。
    const parent = tempRoot();
    writeFileSync(path.join(parent, ".innocence"), "occupied", "utf8");
    const pointerFile = path.join(tempRoot(), "data-root.json");

    const result = await setDataRoot(parent, { pointerFile });
    expect(result.ok).toBe(false);
    expect(appMock.relaunch).not.toHaveBeenCalled();
    expect(existsSync(pointerFile)).toBe(false);
    // 原根保持不动。
    expect(readFileSync(path.join(source, "sessions.json"), "utf8")).toBe("[]");
  });
});

describe("writeDataRootPointer", () => {
  it("写入可读回的指针文件（目录自动创建）", () => {
    const dir = tempRoot();
    const pointer = path.join(dir, "nested", "data-root.json");
    writeDataRootPointer(pointer, "D:\\data\\.innocence");
    expect(JSON.parse(readFileSync(pointer, "utf8"))).toEqual({ root: "D:\\data\\.innocence" });
  });
});
