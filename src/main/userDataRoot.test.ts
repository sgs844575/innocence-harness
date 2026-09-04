// 数据根迁移：列内项移动、目标已存在跳过、缺失忽略、单项失败不中断。
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { APP_DATA_ENTRIES, cleanupElectronDebris, defaultDataRoot, migrateAppData, readDataRootPointer } from "./userDataRoot";

const tempRoots: string[] = [];

function tempRoot(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "udroot-"));
  tempRoots.push(dir);
  return dir;
}

afterEach(() => {
  while (tempRoots.length > 0) rmSync(tempRoots.pop()!, { recursive: true, force: true });
});

describe("defaultDataRoot", () => {
  it("落在 <home>/.innocence", () => {
    expect(defaultDataRoot(path.join("C:", "Users", "u"))).toBe(path.join("C:", "Users", "u", ".innocence"));
  });
});

describe("migrateAppData", () => {
  it("把旧根中的列内数据项移动到新根（含目录内容）", () => {
    const legacy = tempRoot();
    const target = tempRoot();
    writeFileSync(path.join(legacy, "sessions.json"), "[]", "utf8");
    mkdirSync(path.join(legacy, "sessions", "2026", "09", "04"), { recursive: true });
    writeFileSync(path.join(legacy, "sessions", "2026", "09", "04", "s1.jsonl"), "{}\n", "utf8");
    writeFileSync(path.join(legacy, "automations.json"), "{}", "utf8");
    // Electron 自身产物与旧布局 transcripts/ 都不在迁移清单内（transcripts 由
    // sessionFiles.migrateLegacyTranscripts 按会话并入 sessions 树）。
    writeFileSync(path.join(legacy, "Cookies"), "jar", "utf8");
    mkdirSync(path.join(legacy, "transcripts"), { recursive: true });
    writeFileSync(path.join(legacy, "transcripts", "s1.jsonl"), "{}\n", "utf8");

    const outcomes = migrateAppData(legacy, target);

    expect(readFileSync(path.join(target, "sessions.json"), "utf8")).toBe("[]");
    expect(readFileSync(path.join(target, "sessions", "2026", "09", "04", "s1.jsonl"), "utf8")).toBe("{}\n");
    expect(readFileSync(path.join(target, "automations.json"), "utf8")).toBe("{}");
    expect(existsSync(path.join(legacy, "sessions.json"))).toBe(false);
    expect(existsSync(path.join(legacy, "sessions"))).toBe(false);
    expect(existsSync(path.join(legacy, "Cookies"))).toBe(true);
    expect(existsSync(path.join(target, "Cookies"))).toBe(false);
    expect(existsSync(path.join(legacy, "transcripts"))).toBe(true);
    expect(existsSync(path.join(target, "transcripts"))).toBe(false);
    expect(outcomes).toContain("migrated sessions.json");
    expect(outcomes).toContain("migrated sessions");
  });

  it("目标已存在的项跳过（不覆盖不合并），旧根保留原样", () => {
    const legacy = tempRoot();
    const target = tempRoot();
    writeFileSync(path.join(legacy, "harness-settings.json"), '{"old":1}', "utf8");
    writeFileSync(path.join(target, "harness-settings.json"), '{"new":2}', "utf8");

    const outcomes = migrateAppData(legacy, target);

    expect(readFileSync(path.join(target, "harness-settings.json"), "utf8")).toBe('{"new":2}');
    expect(readFileSync(path.join(legacy, "harness-settings.json"), "utf8")).toBe('{"old":1}');
    expect(outcomes.some((o) => o.includes("harness-settings.json"))).toBe(false);
  });

  it("缺失项忽略；旧根不存在也不抛错", () => {
    const target = tempRoot();
    const outcomes = migrateAppData(path.join(tempRoot(), "nonexistent"), target);
    expect(outcomes).toEqual([]);
    expect(APP_DATA_ENTRIES.every((entry) => !existsSync(path.join(target, entry)))).toBe(true);
  });

  it("legacy 与 target 相同是空操作", () => {
    const dir = tempRoot();
    writeFileSync(path.join(dir, "sessions.json"), "[]", "utf8");
    expect(migrateAppData(dir, dir)).toEqual([]);
    expect(readFileSync(path.join(dir, "sessions.json"), "utf8")).toBe("[]");
  });
});

describe("cleanupElectronDebris", () => {
  it("清走数据根内 Electron 自有的缓存/档案，应用数据项绝不动", () => {
    const root = tempRoot();
    mkdirSync(path.join(root, "Cache", "data_0"), { recursive: true });
    writeFileSync(path.join(root, "Cache", "data_0", "f"), "x", "utf8");
    writeFileSync(path.join(root, "Local State"), "{}", "utf8");
    mkdirSync(path.join(root, "Session Storage"), { recursive: true });
    // 应用数据项（同名绝不允许出现在 Electron 清单里）。
    mkdirSync(path.join(root, "sessions", "2026"), { recursive: true });
    writeFileSync(path.join(root, "harness-settings.json"), "{}", "utf8");

    const outcomes = cleanupElectronDebris(root);

    expect(existsSync(path.join(root, "Cache"))).toBe(false);
    expect(existsSync(path.join(root, "Local State"))).toBe(false);
    expect(existsSync(path.join(root, "Session Storage"))).toBe(false);
    expect(existsSync(path.join(root, "sessions"))).toBe(true);
    expect(existsSync(path.join(root, "harness-settings.json"))).toBe(true);
    expect(outcomes).toContain("removed electron debris Cache");
  });

  it("缺失项静默跳过；永不抛错", () => {
    const root = tempRoot();
    expect(() => cleanupElectronDebris(path.join(root, "missing"))).not.toThrow();
    expect(cleanupElectronDebris(root)).toEqual([]);
  });
});

describe("readDataRootPointer", () => {
  it("指针有效且目录可用 → 返回指针根（目录不存在则创建）", () => {
    const dir = tempRoot();
    const pointerRoot = path.join(dir, "custom", ".innocence");
    const pointerFile = path.join(dir, "data-root.json");
    writeFileSync(pointerFile, JSON.stringify({ root: pointerRoot }), "utf8");
    expect(readDataRootPointer(pointerFile)).toBe(pointerRoot);
    expect(existsSync(pointerRoot)).toBe(true);
  });

  it("缺失/损坏/空 root → null", () => {
    const dir = tempRoot();
    expect(readDataRootPointer(path.join(dir, "missing.json"))).toBeNull();
    const corrupt = path.join(dir, "corrupt.json");
    writeFileSync(corrupt, "not json {", "utf8");
    expect(readDataRootPointer(corrupt)).toBeNull();
    const emptyRoot = path.join(dir, "empty.json");
    writeFileSync(emptyRoot, JSON.stringify({ root: "  " }), "utf8");
    expect(readDataRootPointer(emptyRoot)).toBeNull();
    const wrongShape = path.join(dir, "array.json");
    writeFileSync(wrongShape, "[1]", "utf8");
    expect(readDataRootPointer(wrongShape)).toBeNull();
  });

  it("root 指向不可用位置（文件占用）→ null", () => {
    const dir = tempRoot();
    const occupied = path.join(dir, "occupied");
    writeFileSync(occupied, "x", "utf8");
    const pointerFile = path.join(dir, "data-root.json");
    writeFileSync(pointerFile, JSON.stringify({ root: path.join(occupied, ".innocence") }), "utf8");
    expect(readDataRootPointer(pointerFile)).toBeNull();
  });
});
