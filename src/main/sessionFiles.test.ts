// sessions 日期树布局（sessionFiles）直测：分桶路径、扫描（路由/sidecar 消
// 除、旧布局回退）、旧 transcripts 迁移（含双层嵌套事故）、meta 前缀读取。
// 临时目录隔离，不依赖 electron。
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  migrateLegacyTranscripts,
  readSessionMetaPrefix,
  scanSessionFiles,
  sessionFileInTree,
  sessionsRoot,
} from "./sessionFiles";
import { encodeSessionMeta, encodeTurnV2 } from "@innocenceharness/harness-electron";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "ic-session-files-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const treeFile = (id: string, at: Date = new Date(2026, 8, 4)) =>
  sessionFileInTree(sessionsRoot(dir), id, at.getTime());

describe("sessionFiles 布局", () => {
  it("日期分桶：<root>/YYYY/MM/DD/<id>.jsonl（本地时区）", () => {
    expect(treeFile("sess_a", new Date(2026, 8, 4, 10, 30))).toBe(
      path.join(sessionsRoot(dir), "2026", "09", "04", "sess_a.jsonl"),
    );
    expect(treeFile("sess_b", new Date(2025, 0, 2))).toBe(
      path.join(sessionsRoot(dir), "2025", "01", "02", "sess_b.jsonl"),
    );
  });

  it("meta 前缀读取：取前缀内最后一条 session-meta 行（截断安全）", () => {
    const file = treeFile("sess_a");
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(
      file,
      encodeSessionMeta({ id: "sess_a", title: "新会话", createdAt: 1 }, "t0")
        + encodeSessionMeta({ id: "sess_a", title: "改题", createdAt: 1 }, "t1")
        + encodeTurnV2("t1", "t2", [{ role: "user", parts: [{ type: "text", text: "问" }] }]),
      "utf8",
    );
    expect(readSessionMetaPrefix(file)?.title).toBe("改题");
    expect(readSessionMetaPrefix(path.join(dir, "missing.jsonl"))).toBeUndefined();
  });
});

describe("sessionFiles 扫描", () => {
  it("树内主文件、路由文件与 sidecar 正确归类；路由文件不产生幻影会话", () => {
    const main = treeFile("sess_a");
    mkdirSync(path.dirname(main), { recursive: true });
    writeFileSync(main, encodeSessionMeta({ id: "sess_a", title: "A", createdAt: 1 }, "t0"), "utf8");
    writeFileSync(path.join(path.dirname(main), "sess_a_child.jsonl"), "{}\n", "utf8");
    writeFileSync(path.join(path.dirname(main), "sess_a.subagents.jsonl"), "{}\n", "utf8");
    const scanned = scanSessionFiles(dir);
    expect([...scanned.keys()]).toEqual(["sess_a"]);
    expect(scanned.get("sess_a")?.file).toBe(main);
    // meta 按需前缀读（扫描只建映射，不读正文）。
    expect(readSessionMetaPrefix(scanned.get("sess_a")!.file)?.title).toBe("A");
  });

  it("无 meta 的旧式主文件按基名入表；同 id 树内优先于旧 transcripts", () => {
    const legacy = path.join(dir, "transcripts");
    mkdirSync(legacy, { recursive: true });
    writeFileSync(path.join(legacy, "sess_old.jsonl"), "{}\n", "utf8");
    const treeMain = treeFile("sess_old", new Date(2026, 8, 4));
    mkdirSync(path.dirname(treeMain), { recursive: true });
    writeFileSync(treeMain, "{}\n", "utf8");
    const scanned = scanSessionFiles(dir);
    expect(scanned.get("sess_old")?.file).toBe(treeMain);
  });
});

describe("sessionFiles 迁移", () => {
  it("旧扁平 transcripts 按会话成组迁入日期树（主文件+路由+sidecar 同桶）", () => {
    const legacy = path.join(dir, "transcripts");
    mkdirSync(legacy, { recursive: true });
    writeFileSync(path.join(legacy, "sess_m1.jsonl"), encodeTurnV2("t1", "t1", [{ role: "user", parts: [{ type: "text", text: "问" }] }]), "utf8");
    writeFileSync(path.join(legacy, "sess_m1_child.jsonl"), "{}\n", "utf8");
    writeFileSync(path.join(legacy, "sess_m1.subagents.jsonl"), "{}\n", "utf8");

    const outcome = migrateLegacyTranscripts(dir, [dir]);

    expect(outcome.moved).toEqual(["sess_m1"]);
    const target = scanSessionFiles(dir).get("sess_m1")!.file;
    const targetDir = path.dirname(target);
    expect(readdirSync(targetDir).sort()).toEqual(["sess_m1.jsonl", "sess_m1.subagents.jsonl", "sess_m1_child.jsonl"].sort());
    expect(existsSync(path.join(legacy, "sess_m1.jsonl"))).toBe(false);
    // 幂等：再跑一遍无事发生。
    expect(migrateLegacyTranscripts(dir, [dir]).moved).toEqual([]);
  });

  it("历史双层嵌套事故（transcripts/transcripts）同样被吸收", () => {
    const nested = path.join(dir, "transcripts", "transcripts");
    mkdirSync(nested, { recursive: true });
    writeFileSync(path.join(nested, "sess_n1.jsonl"), "{}\n", "utf8");
    const outcome = migrateLegacyTranscripts(dir, [dir]);
    expect(outcome.moved).toEqual(["sess_n1"]);
    expect(existsSync(path.join(nested, "sess_n1.jsonl"))).toBe(false);
  });

  it("目标已存在的会话整组跳过（新布局优先，不覆盖）", () => {
    const legacy = path.join(dir, "transcripts");
    mkdirSync(legacy, { recursive: true });
    writeFileSync(path.join(legacy, "sess_x.jsonl"), "legacy\n", "utf8");
    const treeMain = treeFile("sess_x", new Date(2026, 8, 4));
    mkdirSync(path.dirname(treeMain), { recursive: true });
    writeFileSync(treeMain, "tree\n", "utf8");
    const outcome = migrateLegacyTranscripts(dir, [dir]);
    expect(outcome.skipped).toEqual(["sess_x"]);
    expect(readFileSync(treeMain, "utf8")).toBe("tree\n");
  });
});
