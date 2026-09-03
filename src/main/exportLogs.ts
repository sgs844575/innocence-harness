// 「导出日志」的文件复制：把日志目录里的全部文件平铺复制到用户所选目录。
// 纯 Node fs 实现（无 electron 依赖），目录选择/userData 定位在 ipc.ts 薄壳。
import fs from "node:fs/promises";
import path from "node:path";

/** 复制 logsDir 下的常规文件到 targetDir（已存在则覆盖）；返回复制数。
 *  日志目录不存在/为空 → 0。 */
export async function copyLogFiles(logsDir: string, targetDir: string): Promise<number> {
  let entries: string[];
  try {
    entries = await fs.readdir(logsDir);
  } catch {
    return 0;
  }
  let copied = 0;
  for (const name of entries) {
    const source = path.join(logsDir, name);
    const stat = await fs.stat(source).catch(() => null);
    if (!stat?.isFile()) continue;
    await fs.copyFile(source, path.join(targetDir, name));
    copied += 1;
  }
  return copied;
}
