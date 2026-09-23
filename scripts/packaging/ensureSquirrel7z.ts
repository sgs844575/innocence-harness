// Squirrel 安装器（electron-winstaller vendor 里的 Squirrel.exe）在 releasify
// 时以自身目录解析并拉起 `7z.exe` 压缩/解压 nupkg；vendor 只带架构后缀名
// `7z-x64.exe`/`7z-x64.dll`，没有标准名文件，缺失时报
// “Win32Exception: 系统找不到指定的文件（CreateZipFromDirectory）”。本脚本
// 在 make 前把 vendor 内的架构副本补齐为标准名（幂等，仅本机 node_modules，
// 不入库）。上游若改为直接使用带后缀文件或恢复外部 7-Zip 依赖，这里自然
// 变为 no-op。
import { cpSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const vendorDir = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "node_modules",
  "electron-winstaller",
  "vendor",
);

const pairs: Array<[source: string, target: string]> = [
  ["7z-x64.exe", "7z.exe"],
  ["7z-x64.dll", "7z.dll"],
];

let copied = 0;
for (const [source, target] of pairs) {
  const sourcePath = join(vendorDir, source);
  const targetPath = join(vendorDir, target);
  if (existsSync(targetPath)) continue;
  if (!existsSync(sourcePath)) {
    // 布局与预期不符（上游已变更）或依赖缺失：不阻断，交给 make 的原始
    // 报错定位；成功复制另一半没有意义，成对要求。
    console.warn(`[ensureSquirrel7z] vendor 缺少 ${source}，跳过（make 若失败请检查 electron-winstaller 安装）`);
    continue;
  }
  cpSync(sourcePath, targetPath);
  copied += 1;
}

console.log(`[ensureSquirrel7z] vendor=${vendorDir} 补齐 ${copied} 个 7-Zip 标准名文件`);
