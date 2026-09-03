// 数据根迁移：列内项移动、目标已存在跳过、缺失忽略、单项失败不中断。
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { APP_DATA_ENTRIES, defaultDataRoot, migrateAppData } from "./userDataRoot";

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
    mkdirSync(path.join(legacy, "transcripts"), { recursive: true });
    writeFileSync(path.join(legacy, "transcripts", "s1.jsonl"), "{}\n", "utf8");
    writeFileSync(path.join(legacy, "automations.json"), "{}", "utf8");
    // Electron 自身产物不在迁移清单内。
    writeFileSync(path.join(legacy, "Cookies"), "jar", "utf8");

    const outcomes = migrateAppData(legacy, target);

    expect(readFileSync(path.join(target, "sessions.json"), "utf8")).toBe("[]");
    expect(readFileSync(path.join(target, "transcripts", "s1.jsonl"), "utf8")).toBe("{}\n");
    expect(readFileSync(path.join(target, "automations.json"), "utf8")).toBe("{}");
    expect(existsSync(path.join(legacy, "sessions.json"))).toBe(false);
    expect(existsSync(path.join(legacy, "transcripts"))).toBe(false);
    expect(existsSync(path.join(legacy, "Cookies"))).toBe(true);
    expect(existsSync(path.join(target, "Cookies"))).toBe(false);
    expect(outcomes).toContain("migrated sessions.json");
    expect(outcomes).toContain("migrated transcripts");
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
