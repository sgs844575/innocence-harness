// 打包版本计数器：npm run package 的 postpackage 钩子——每次成功打包把根
// package.json 的版本号最后一位（patch）+1，major.minor 人工控制。因此本次
// 打包产物使用的是打包前的版本号，package.json 在打包成功后指向下一版。
// 只替换版本行原文，文件其余字节（键序/缩进/行尾）原样保留，不整文件重序
// 列化——diff 里只有版本号一行。预发布号（如 0.2.0-beta.1）不自动递增，
// 显式报错交还人工处理。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { inc as semverInc } from "semver";

const PACKAGE_FILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../package.json");

export interface BumpPatchResult {
  text: string;
  from: string;
  to: string;
}

/** 纯函数：把 package.json 文本中的 "version": "X.Y.Z" 最后一位 +1，其余字节原样保留。 */
export function bumpPatchVersion(text: string): BumpPatchResult {
  const match = text.match(/"version"\s*:\s*"(\d+\.\d+\.\d+)"/);
  if (match === null) {
    throw new Error(`package.json 缺少 "version": "X.Y.Z" 形式的版本号（预发布号需人工处理），无法递增`);
  }
  const from = match[1]!;
  const to = semverInc(from, "patch");
  if (to === null) throw new Error(`版本号 ${from} 无法递增最后一位`);
  return { text: text.replace(match[0], `"version": "${to}"`), from, to };
}

function runBump(): void {
  const raw = fs.readFileSync(PACKAGE_FILE, "utf8");
  const { text, from, to } = bumpPatchVersion(raw);
  fs.writeFileSync(PACKAGE_FILE, text, "utf8");
  console.log(`PACKAGE_VERSION bumped ${from} -> ${to}（本次打包产物为 ${from}；major.minor 人工控制）`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  try {
    runBump();
  } catch (error: unknown) {
    console.error(`PACKAGE_VERSION fail ${String(error)}`);
    process.exitCode = 1;
  }
}
