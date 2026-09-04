// 数据存储位置（常规设置）：查询当前数据根 + 迁移到新位置（守卫 → 复制应
// 用自有数据项 → 写指针文件 → 300ms 后重启生效）。数据根在启动早期解析
// （index.ts 经 userDataRoot 指针 initAppDataRoot 注入，见 appDataRoot），
// 迁移后必须重启才生效。守卫/复制/指针写入是纯 Node（可测），Electron 接
// 触点集中在重启尾段。
import { app } from "electron";
import fs from "node:fs";
import path from "node:path";
import { appDataRoot } from "./appDataRoot";
import { APP_DATA_ENTRIES, defaultDataRoot } from "./userDataRoot";

export interface DataRootInfo {
  path: string;
  defaultPath: string;
}

export function getDataRoot(): DataRootInfo {
  return { path: appDataRoot(), defaultPath: defaultDataRoot() };
}

export type DataRootGuard = { ok: true; target: string } | { ok: false; error: string };

/** 比较用规范化：解析为绝对路径；Windows 路径大小写不敏感。 */
function normalizeForCompare(p: string): string {
  const resolved = path.resolve(p);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

/** 路径包含关系：candidate 是否位于 base 之内（相等由调用方先判）。 */
function isInside(base: string, candidate: string): boolean {
  const rel = path.relative(normalizeForCompare(base), normalizeForCompare(candidate));
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

/**
 * 新数据根守卫（纯函数）：非空；target = parent/.innocence；≠ 当前根且互
 * 不包含（防自复制死循环与嵌套数据根）；父目录存在且可写。
 */
export function guardDataRootTarget(parentDir: unknown, currentRoot: string): DataRootGuard {
  if (typeof parentDir !== "string" || parentDir.trim() === "") {
    return { ok: false, error: "empty directory" };
  }
  const parent = path.resolve(parentDir.trim());
  const target = path.join(parent, ".innocence");
  if (normalizeForCompare(target) === normalizeForCompare(currentRoot)) {
    return { ok: false, error: "target is the current data root" };
  }
  if (isInside(currentRoot, target) || isInside(target, currentRoot)) {
    return { ok: false, error: "target overlaps the current data root" };
  }
  try {
    if (!fs.statSync(parent).isDirectory()) return { ok: false, error: "not a directory" };
  } catch {
    return { ok: false, error: "directory does not exist" };
  }
  try {
    fs.accessSync(parent, fs.constants.W_OK);
  } catch {
    return { ok: false, error: "directory is not writable" };
  }
  return { ok: true, target };
}

/**
 * 把当前根中的应用自有数据项复制到新根（缺项跳过；force 覆盖同名目标）。
 * 任何一项失败即抛错——调用方回报失败且不重启；部分复制可接受，原根不动。
 */
export async function copyAppDataEntries(sourceRoot: string, targetRoot: string): Promise<void> {
  for (const entry of APP_DATA_ENTRIES) {
    const source = path.join(sourceRoot, entry);
    if (!fs.existsSync(source)) continue;
    const target = path.join(targetRoot, entry);
    await fs.promises.mkdir(path.dirname(target), { recursive: true });
    await fs.promises.cp(source, target, { recursive: true, force: true });
  }
}

/** 指针文件写入（默认根下 data-root.json；userDataRoot.readDataRootPointer 消费）。 */
export function writeDataRootPointer(pointerFile: string, root: string): void {
  fs.mkdirSync(path.dirname(pointerFile), { recursive: true });
  fs.writeFileSync(pointerFile, JSON.stringify({ root }), "utf8");
}

/**
 * 迁移数据根：守卫失败/复制失败/指针写失败都返回 { ok: false } 且不重启
 * （原根始终可用）；成功后写指针、应答 { ok: true }，300ms 后 relaunch +
 * exit（数据根在启动早期解析，必须重启生效；延迟让 IPC 应答先回到渲染层）。
 * options.pointerFile 是测试注入缝（缺省 = 默认根下的 data-root.json）。
 */
export async function setDataRoot(
  parentDir: string,
  options?: { pointerFile?: string },
): Promise<{ ok: boolean; error?: string }> {
  const current = appDataRoot();
  const guard = guardDataRootTarget(parentDir, current);
  if (!guard.ok) return { ok: false, error: guard.error };
  try {
    await copyAppDataEntries(current, guard.target);
  } catch (error) {
    return { ok: false, error: String(error) };
  }
  try {
    writeDataRootPointer(options?.pointerFile ?? path.join(defaultDataRoot(), "data-root.json"), guard.target);
  } catch (error) {
    return { ok: false, error: String(error) };
  }
  setTimeout(() => {
    app.relaunch();
    app.exit(0);
  }, 300);
  return { ok: true };
}
