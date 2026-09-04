// 应用数据根责任：默认根 ~/.innocence（与插件、技能、记忆、临时目录同属一
// 根，参考其他 AI 工具的 ~/.<tool> 惯例）；Electron 自身的 userData 不再重
// 定向 —— Chromium 缓存/档案留在默认 Roaming/<name>，本模块只负责应用自有
// 数据项的定位与一次性 best-effort 迁移（含改名前旧根），以及清理历史重定
// 向残留在数据根里的 Electron 垃圾。纯 Node fs 实现，便于测试。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * 数据根内应用自有的数据项（Electron 自身的 Cache/Local Storage 等不在其
 * 列，留在默认 userData 由运行时按需重建）：
 * - sessions.json / sidebar.json：会话索引（可由 sessions/ 树重建的缓存）与
 *   侧栏分组索引
 * - sessions/：会话转写树（YYYY/MM/DD/<id>.jsonl，含 <id>.subagents.jsonl
 *   子代理档案与 <id>_<routeId>.jsonl 路由转写）
 * - logs/：主进程日志（应用菜单「导出日志」的来源）
 * - tasks/：任务运行私有存储（含工作树元数据）
 * - background/：后台作业暂存
 * - automations.json / harness-settings.json：自动化与外观/模型设置
 * - provider-credentials/：供应商凭据
 * 旧布局的 transcripts/ 不做整目录迁移 —— 会话文件按 id 逐个并入 sessions/
 * 树（见 sessionFiles.migrateLegacyTranscripts），索引由启动扫描重建。
 */
export const APP_DATA_ENTRIES: readonly string[] = [
  "sessions.json",
  "sidebar.json",
  "sessions",
  "logs",
  "tasks",
  "background",
  "automations.json",
  "harness-settings.json",
  "provider-credentials",
];

/** 统一数据根：<home>/.innocence。 */
export function defaultDataRoot(homeDir: string = os.homedir()): string {
  return path.join(homeDir, ".innocence");
}

/**
 * 数据根指针（用户改过存储位置）：pointerFile 形如 {"root": string}。解析
 * 成功、root 非空且目录可用（mkdir recursive 命中或创建）时返回该根；损坏/
 * 缺失/不可写一律回落 null（调用方用默认根）。best-effort，永不抛错——与
 * 迁移同理，启动路径不容因指针损坏而拒绝启动。
 */
export function readDataRootPointer(pointerFile: string): string | null {
  try {
    const raw: unknown = JSON.parse(fs.readFileSync(pointerFile, "utf8"));
    const root = (raw as { root?: unknown })?.root;
    if (typeof root !== "string" || root.trim() === "") return null;
    fs.mkdirSync(root, { recursive: true });
    return root;
  } catch {
    return null;
  }
}

/**
 * 把 legacyRoot 中的应用数据项迁到 targetRoot：目标已存在的项跳过（不合
 * 并、不覆盖），缺失的项忽略；单项失败仅记录不中断。优先 rename（同卷零
 * 成本），跨卷等失败回退复制+删除。返回每条迁移结果供调用方写日志。永不
 * 抛错——启动路径不容因迁移失败而拒绝启动。
 */
export function migrateAppData(legacyRoot: string, targetRoot: string): string[] {
  const outcomes: string[] = [];
  if (legacyRoot === targetRoot) return outcomes;
  for (const entry of APP_DATA_ENTRIES) {
    const from = path.join(legacyRoot, entry);
    const to = path.join(targetRoot, entry);
    try {
      if (!fs.existsSync(from) || fs.existsSync(to)) continue;
      fs.mkdirSync(path.dirname(to), { recursive: true });
      try {
        fs.renameSync(from, to);
      } catch {
        fs.cpSync(from, to, { recursive: true });
        fs.rmSync(from, { recursive: true, force: true });
      }
      outcomes.push(`migrated ${entry}`);
    } catch (error) {
      outcomes.push(`failed to migrate ${entry}: ${String(error)}`);
    }
  }
  return outcomes;
}

/**
 * 历史上 userData 曾被整体重定向到数据根，Chromium 因此在数据根里落下了
 * 自己的缓存/档案。这些名字归 Electron 所有（应用数据项绝不重名），应用
 * 不再重定向后一次性清走，让数据根回到纯应用数据。best-effort，永不抛错。
 */
export const ELECTRON_OWNED_DEBRIS: readonly string[] = [
  "blob_storage",
  "Cache",
  "Code Cache",
  "crashDumps",
  "DawnCache",
  "DawnGraphiteCache",
  "DawnWebGPUCache",
  "DevToolsActivePort",
  "Dictionaries",
  "DIPS",
  "DIPS-wal",
  "GPUCache",
  "GrShaderCache",
  "Local State",
  "Local Storage",
  "Network",
  "Partitions",
  "Preferences",
  "Session Storage",
  "ShaderCache",
  "Shared Dictionary",
  "Shared vk images",
  "SharedStorage",
  "SharedStorage-wal",
  "Trust Database",
  "WebStorage",
];

/** 清理数据根内的 Electron 遗留物，返回每条结果供日志。 */
export function cleanupElectronDebris(root: string): string[] {
  const outcomes: string[] = [];
  for (const entry of ELECTRON_OWNED_DEBRIS) {
    const target = path.join(root, entry);
    try {
      if (!fs.existsSync(target)) continue;
      fs.rmSync(target, { recursive: true, force: true });
      outcomes.push(`removed electron debris ${entry}`);
    } catch (error) {
      outcomes.push(`failed to remove electron debris ${entry}: ${String(error)}`);
    }
  }
  return outcomes;
}
