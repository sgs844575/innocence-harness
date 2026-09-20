// 工作台存储面：<数据根>/workbench/<id>/ 一目录一应用，元数据落
// workbench.json（id/name/createdAt/updatedAt），应用本体是目录内的静态
// 文件（index.html 入口）。根惰性解析（appDataRoot 每次调用现读，可注入
// 覆盖便于测试）。id 是目录名：名称 slug 化（小写字母/数字/连字符），重名
// 追加 -2/-3…。
import fs from "node:fs/promises";
import path from "node:path";
import type { WorkbenchMeta } from "../shared/workbenchIpc";
import { appDataRoot } from "./appDataRoot";

const ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

/** 工作台存储根（每次调用现读数据根，绝不在模块加载期固化）。 */
export function workbenchRoot(root?: string): string {
  return root ?? path.join(appDataRoot(), "workbench");
}

/** id 是纯目录段（点前缀、分隔符、盘符一律拒绝）——拼接路径不得经 id 逃逸。 */
export function assertWorkbenchId(id: string): void {
  if (
    typeof id !== "string" ||
    id === "" ||
    id.startsWith(".") ||
    id.includes("/") ||
    id.includes("\\") ||
    /^[a-zA-Z]:/.test(id)
  ) {
    throw new Error("Invalid workbench id.");
  }
}

function slugify(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
  return ID_PATTERN.test(slug) ? slug : "workbench";
}

interface WorkbenchFile {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

function isWorkbenchFile(value: unknown): value is WorkbenchFile {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return [record.id, record.name, record.createdAt, record.updatedAt].every((field) => typeof field === "string");
}

async function readMeta(dir: string): Promise<WorkbenchFile | null> {
  try {
    const parsed: unknown = JSON.parse(await fs.readFile(path.join(dir, "workbench.json"), "utf8"));
    return isWorkbenchFile(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

async function writeMeta(dir: string, meta: WorkbenchFile): Promise<void> {
  await fs.writeFile(path.join(dir, "workbench.json"), JSON.stringify(meta, null, 2), "utf8");
}

const withDir = (root: string, meta: WorkbenchFile): WorkbenchMeta => ({ ...meta, dir: path.join(root, meta.id) });

/** 列出全部工作台（按 updatedAt 倒序）；畸形条目跳过。 */
export async function listWorkbenches(root?: string): Promise<WorkbenchMeta[]> {
  const base = workbenchRoot(root);
  const rows: WorkbenchMeta[] = [];
  for (const entry of await fs.readdir(base).catch(() => [] as string[])) {
    const dir = path.join(base, entry);
    const stat = await fs.lstat(dir).catch(() => null);
    if (!stat?.isDirectory() || stat.isSymbolicLink()) continue;
    const meta = await readMeta(dir);
    if (meta && meta.id === entry) rows.push(withDir(base, meta));
  }
  return rows.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/** 新建工作台：派生唯一 id、建目录、落元数据与自包含的起步 index.html。 */
export async function createWorkbench(name: string, root?: string): Promise<WorkbenchMeta> {
  if (typeof name !== "string" || name.trim() === "") throw new Error("Invalid workbench name.");
  const base = workbenchRoot(root);
  await fs.mkdir(base, { recursive: true });
  const baseId = slugify(name);
  let id = baseId;
  for (let suffix = 2; await exists(path.join(base, id)); suffix++) id = `${baseId}-${suffix}`;
  const dir = path.join(base, id);
  await fs.mkdir(dir);
  const now = new Date().toISOString();
  const meta: WorkbenchFile = { id, name: name.trim(), createdAt: now, updatedAt: now };
  await writeMeta(dir, meta);
  await fs.writeFile(path.join(dir, "index.html"), STARTER_HTML, "utf8");
  return withDir(base, meta);
}

/** 删除整个工作台目录。 */
export async function removeWorkbench(id: string, root?: string): Promise<void> {
  assertWorkbenchId(id);
  await fs.rm(path.join(workbenchRoot(root), id), { recursive: true });
}

/** 内容变更后 bumped updatedAt（列表排序/展示用；只重写元数据文件）。 */
export async function touchWorkbench(id: string, root?: string): Promise<void> {
  assertWorkbenchId(id);
  const dir = path.join(workbenchRoot(root), id);
  const meta = await readMeta(dir);
  if (!meta) throw new Error("Unknown workbench.");
  await writeMeta(dir, { ...meta, updatedAt: new Date().toISOString() });
}

async function exists(target: string): Promise<boolean> {
  return (await fs.lstat(target).catch(() => null)) !== null;
}

// 起步页：自包含、仅内联样式、系统字体栈、深色中性底——无外链资源（工作台
// iframe 是独立源），文案指引用户去对话里描述需求（中立措辞，双语一行）。
const STARTER_HTML = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Workbench</title>
<style>
  html, body { margin: 0; height: 100%; }
  body {
    display: grid; place-items: center;
    background: #0f0f10; color: #e8e8ea;
    font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
  }
  main { max-width: 26rem; padding: 24px; text-align: center; }
  h1 { font-size: 18px; font-weight: 600; margin: 0 0 8px; }
  p { color: #9a9aa0; font-size: 14px; line-height: 1.7; margin: 0; }
</style>
</head>
<body>
<main>
  <h1>这个工作台还是空的</h1>
  <p>在对话中描述你想要的工具，助手会在这里搭建它。<br />This workbench is empty &mdash; describe the tool you want in the chat and the agent will build it here.</p>
</main>
</body>
</html>
`;
