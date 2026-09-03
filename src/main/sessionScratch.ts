// 无项目会话的暂存工作区：会话既未绑定项目、也没有全局工作区时的最终
// 落点——每会话独立目录（~/.innocence/tmp/<sessionId>，按需创建），让
// 文件/终端工具锚定在用户数据命名空间，而不是进程安装目录
// （process.cwd()）。会话删除时随转录一并尽力清理。模块保持
// electron-free，vitest 可直接驱动（同 sessions.ts 约定）。
import { mkdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

// 持久化索引里的 id 是自由字符串（loadSessionIndex 只校验 string），拼路径
// 前必须挡住遍历分量：仅放行字母/数字/下划线/连字符，路径分隔符、点等
// 一律拒绝。
const SAFE_SESSION_ID = /^[A-Za-z0-9_-]+$/;

/** Per-session scratch dir under the user-space data root; undefined for ids
 *  that could traverse out of the tmp namespace. */
export function sessionScratchDir(sessionId: string, homeDir: string = os.homedir()): string | undefined {
  if (!SAFE_SESSION_ID.test(sessionId)) return undefined;
  return path.join(homeDir, ".innocence", "tmp", sessionId);
}

/** Ensures the session's scratch dir exists (recursive, idempotent); undefined
 *  for unsafe ids so callers keep their existing fallback chain. */
export async function ensureSessionScratchDir(sessionId: string, homeDir?: string): Promise<string | undefined> {
  const dir = sessionScratchDir(sessionId, homeDir);
  if (dir) await mkdir(dir, { recursive: true });
  return dir;
}

/** Best-effort scratch cleanup on session delete（与转录删除同一契约：失败
 *  不阻断删除，被占用的目录留给后续手动清理）。异步执行并带 Windows 重试
 *  ——暂存目录可能是工具落盘的大树，同步递归删除会阻塞主进程事件循环。 */
export async function removeSessionScratchDir(sessionId: string, homeDir?: string): Promise<void> {
  const dir = sessionScratchDir(sessionId, homeDir);
  if (!dir) return;
  try {
    await rm(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  } catch {
    // Removal is best-effort; a locked dir simply outlives the session.
  }
}
