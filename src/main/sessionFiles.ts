// 会话文件树责任（会话外观的存储布局拆分）：sessions/ 日期分桶布局
// （<root>/YYYY/MM/DD/<id>.jsonl，参考主流 CLI 会话存档的按日归档模式）、
// 启动扫描（id → 主文件映射，含旧扁平 transcripts 布局回退与路由/档案
// sidecar 识别）、旧转录文件按 id 逐个迁入树（整目录跳过语义的替代——旧
// 数据不再被静默遗弃）。electron-free，Node 可测。
import fs from "node:fs";
import path from "node:path";
import { decodeTranscript, type SessionMetaRecord } from "@innocenceharness/harness-electron";

/** sessions 根：<storeDir>/sessions。 */
export function sessionsRoot(storeDir: string): string {
  return path.join(storeDir, "sessions");
}

/** 旧扁平布局根（历史迁移源/回退扫描源）：<storeDir>/transcripts。 */
export function legacyTranscriptsRoot(storeDir: string): string {
  return path.join(storeDir, "transcripts");
}

/** 日期分桶路径：<root>/YYYY/MM/DD/<id>.jsonl（本地时区的创建时刻）。 */
export function sessionFileInTree(root: string, id: string, createdAt: number): string {
  const date = new Date(createdAt);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return path.join(root, String(date.getFullYear()), month, day, `${id}.jsonl`);
}

/** 扫描产物：一个会话的主文件及其自描述元数据（旧文件可能没有 meta 行）。 */
export interface ScannedSessionFile {
  file: string;
  meta?: SessionMetaRecord;
  mtimeMs: number;
}

/**
 * 读取一个转录文件前缀里最后一条 session-meta 行（自描述头；截断安全——
 * 只解析完整行）。meta 行在创建时写入、变化时追加，前缀几乎总能命中创建
 * 行；启动扫描只需廉价前缀读，全文折叠交给 hydration。
 */
export function readSessionMetaPrefix(file: string, maxBytes = 8192): SessionMetaRecord | undefined {
  let handle: number;
  try {
    handle = fs.openSync(file, "r");
  } catch {
    return undefined;
  }
  try {
    const buffer = Buffer.alloc(maxBytes);
    const bytesRead = fs.readSync(handle, buffer, 0, maxBytes, 0);
    const text = buffer.toString("utf8", 0, bytesRead);
    const stop = text.lastIndexOf("\n");
    if (stop <= 0) return undefined;
    // 复用解码器的行折叠：单行 meta 直接解析，避免为一条记录跑全文解码。
    for (const line of text.slice(0, stop).split(/\r?\n/).reverse()) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const meta = decodeTranscript(`${trimmed}\n`).meta;
        if (meta) return meta;
      } catch {
        // 坏行继续向前找。
      }
    }
    return undefined;
  } finally {
    fs.closeSync(handle);
  }
}

/** 递归收集 root 下全部 .jsonl 文件（目录不存在返回空；单目录失败跳过）。 */
function collectJsonlFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && entry.name.endsWith(".jsonl")) out.push(full);
    }
  };
  if (fs.existsSync(root)) walk(root);
  return out;
}

/** jsonl 基名（去扩展名）；.subagents sidecar 返回 null。 */
function mainCandidateName(fileName: string): string | null {
  if (!fileName.endsWith(".jsonl")) return null;
  const base = fileName.slice(0, -".jsonl".length);
  return base.endsWith(".subagents") ? null : base;
}

/**
 * 扫描 sessions 树与旧 transcripts 扁平目录，建立 id → 主文件映射。路由
 * 文件（<id>_<routeId>.jsonl）与档案 sidecar（<id>.subagents.jsonl）不单
 * 独成会话：候选基名若是另一候选加 "_" 的延伸即判为路由文件（生成的会话
 * id 形如 sess_<ts>_<rand>，固定三段，绝不互相前缀延伸）。同 id 树内文件
 * 优先于旧布局；同目录多源冲突保留先见。只建映射不读正文——meta 按需前缀
 * 读（rebuildOnly 由调用方决定哪些 id 需要元数据）。
 */
export function scanSessionFiles(storeDir: string): Map<string, ScannedSessionFile> {
  const sources = [sessionsRoot(storeDir), legacyTranscriptsRoot(storeDir)];
  const files: string[] = [];
  for (const source of sources) files.push(...collectJsonlFiles(source));

  // 候选池（目录 → 基名集合）用于路由文件消除。
  const byDir = new Map<string, Set<string>>();
  for (const file of files) {
    const dir = path.dirname(file);
    const name = mainCandidateName(path.basename(file));
    if (name === null) continue;
    let set = byDir.get(dir);
    if (!set) {
      set = new Set<string>();
      byDir.set(dir, set);
    }
    set.add(name);
  }
  const isRouteFile = (dir: string, name: string): boolean => {
    const peers = byDir.get(dir);
    if (!peers) return false;
    for (const peer of peers) {
      if (peer !== name && name.startsWith(`${peer}_`)) return true;
    }
    return false;
  };

  const out = new Map<string, ScannedSessionFile>();
  // 树内源在前：同 id 时先登记的（树内）保留。
  for (const file of files) {
    const name = mainCandidateName(path.basename(file));
    if (name === null) continue;
    if (isRouteFile(path.dirname(file), name)) continue;
    if (out.has(name)) continue;
    let mtimeMs = 0;
    try {
      mtimeMs = fs.statSync(file).mtimeMs;
    } catch {
      // 竞态删除：保留 0，条目仍可被 hydration 兜底。
    }
    out.set(name, { file, mtimeMs });
  }
  return out;
}

/** 迁移结果汇总（best-effort，调用方记日志）。 */
export interface TranscriptMigrationOutcome {
  moved: string[];
  skipped: string[];
  failed: string[];
}

/**
 * 把 sourceRoots 下的旧扁平转录（含历史双层嵌套事故 transcripts/transcripts）
 * 按 id 逐个迁入 sessions 日期树：主文件按 mtime 分桶，同 id 的路由文件
 * （<id>_*.jsonl）与档案（<id>.subagents.jsonl）随主文件进同桶（路由解析
 * 依赖与主文件同目录）。目标已存在的 id 整组跳过（新布局优先，不覆盖）；
 * 迁移后清理空目录。best-effort，永不抛错。
 */
export function migrateLegacyTranscripts(
  storeDir: string,
  sourceRoots: readonly string[],
): TranscriptMigrationOutcome {
  const outcome: TranscriptMigrationOutcome = { moved: [], skipped: [], failed: [] };
  const root = sessionsRoot(storeDir);
  // 目标已存在的 id 整组跳过（新布局优先，不覆盖）：以树内主文件 id 集合
  // 为准，而非 mtime 推导的具体桶——历史迁移过的 id 可能落在与本次推导
  // 不同的日期桶，按桶判定会 fork 出第二个主文件。迁移成功后同样入集，
  // 防止多源根携带同一 id 时重复落位。
  const treeMainIds = new Set(
    collectJsonlFiles(root)
      .map((file) => mainCandidateName(path.basename(file)))
      .filter((name): name is string => name !== null),
  );
  const sources = sourceRoots
    .map((source) => (path.basename(source) === "transcripts" ? source : path.join(source, "transcripts")))
    .filter((source, index, all) => source !== root && all.indexOf(source) === index);
  for (const source of sources) {
    const files = collectJsonlFiles(source);
    // 源内候选池：主文件名是另一候选加 "_" 的延伸 → 路由文件，不独立迁移
    //（随主文件成组搬；孤儿路由文件无主可随，留在原地）。
    const peersByDir = new Map<string, Set<string>>();
    for (const file of files) {
      const name = mainCandidateName(path.basename(file));
      if (name === null) continue;
      const dir = path.dirname(file);
      let set = peersByDir.get(dir);
      if (!set) {
        set = new Set<string>();
        peersByDir.set(dir, set);
      }
      set.add(name);
    }
    for (const file of files) {
      const name = mainCandidateName(path.basename(file));
      if (name === null) continue;
      if (file !== path.join(path.dirname(file), `${name}.jsonl`)) continue;
      const peers = peersByDir.get(path.dirname(file)) ?? new Set<string>();
      if ([...peers].some((peer) => peer !== name && name.startsWith(`${peer}_`))) continue;
      try {
        const createdAt = fs.statSync(file).mtimeMs;
        const target = sessionFileInTree(root, name, createdAt);
        if (treeMainIds.has(name)) {
          outcome.skipped.push(name);
          continue;
        }
        fs.mkdirSync(path.dirname(target), { recursive: true });
        const group = collectJsonlFiles(path.dirname(file)).filter((candidate) => {
          const base = path.basename(candidate);
          return base === `${name}.jsonl`
            || base === `${name}.subagents.jsonl`
            || (base.startsWith(`${name}_`) && base.endsWith(".jsonl"));
        });
        for (const member of group) {
          const memberTarget = path.join(path.dirname(target), path.basename(member));
          if (fs.existsSync(memberTarget)) continue;
          try {
            fs.renameSync(member, memberTarget);
          } catch {
            fs.cpSync(member, memberTarget);
            fs.rmSync(member, { force: true });
          }
        }
        outcome.moved.push(name);
        treeMainIds.add(name);
      } catch (error) {
        outcome.failed.push(`${name}: ${String(error)}`);
      }
    }
    // 清理搬空的目录（保留 transcripts 根本身作历史痕迹）。
    try {
      removeEmptyDirs(source);
    } catch {
      // 清理失败无关紧要。
    }
  }
  return outcome;
}

/** 递归删除 source 下的空子目录（不删 source 本身）。 */
function removeEmptyDirs(source: string): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(source, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const full = path.join(source, entry.name);
    removeEmptyDirs(full);
    try {
      fs.rmdirSync(full);
    } catch {
      // 非空/占用：保留。
    }
  }
}
