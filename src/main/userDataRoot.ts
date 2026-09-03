// 应用数据根责任：把 Electron userData 统一定位到 ~/.innocence（与插件、
// 技能、记忆、临时目录同属一根，参考其他 AI 工具的 ~/.<tool> 惯例），并把
// 旧默认根（appData/<name>）里应用自有的数据项做一次性 best-effort 迁移。
// 纯 Node fs 实现，Electron 侧只做 setPath 薄壳（index.ts），便于测试。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * userData 根内应用自有的数据项（Electron 自身的 Cache/Local Storage 等不在
 * 其列，留在旧根由运行时按需重建）：
 * - sessions.json / sidebar.json：会话索引与侧栏分组索引
 * - transcripts/：会话转写（含 <id>.subagents.jsonl 子代理历史）
 * - logs/：主进程日志（应用菜单「导出日志」的来源）
 * - tasks/：任务运行私有存储（含工作树元数据）
 * - background/：后台作业暂存
 * - automations.json / harness-settings.json：自动化与外观/模型设置
 * - provider-credentials/：供应商凭据
 */
export const APP_DATA_ENTRIES: readonly string[] = [
  "sessions.json",
  "sidebar.json",
  "transcripts",
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
 * 把 legacyRoot 中的应用数据项迁到 targetRoot：目标已存在的项跳过（不合
 * 并、不覆盖），缺失的项忽略；单项失败仅记录不中断。优先 rename（同卷零
 * 成本），跨卷等失败回退复制+删除。返回每条迁移结果供调用方在 setPath
 * 之后写日志。永不抛错——启动路径不容因迁移失败而拒绝启动。
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
