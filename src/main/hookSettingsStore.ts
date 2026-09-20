// 钩子设置面的层文件读写（管理面）：顶层 `hooks:` 数组的原始读写，保留文档
// 其余顶层键与条目上的未知字段（操作对象是 yaml 解析出的原文档，不是投影
// 类型）。与 configSources 的容错读取不同：管理面对损坏文件必须拒绝静默—
// —写入一个读不懂的文件会摧毁它。写入经 临时文件 + rename 落盘。
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml, stringify } from "yaml";

/** Reads one layer file into its raw mapping; undefined = file absent. */
async function readDocument(file: string): Promise<Record<string, unknown> | undefined> {
  let raw: string;
  try {
    raw = await fs.readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  let doc: unknown;
  try {
    doc = parseYaml(raw);
  } catch {
    throw new Error(`Hooks config file is not parseable: ${file}`);
  }
  // 空文件等价于空映射（与读取面一致：存在但无内容不产生任何键）。
  if (doc === null || doc === undefined) return {};
  if (typeof doc !== "object" || Array.isArray(doc)) {
    throw new Error(`Hooks config file must be a mapping: ${file}`);
  }
  return doc as Record<string, unknown>;
}

/** Reads the top-level `hooks:` array; missing file / missing key → []. */
export async function readHooksFile(file: string): Promise<unknown[]> {
  const doc = await readDocument(file);
  if (doc === undefined) return [];
  const hooks = doc.hooks;
  if (hooks === undefined) return [];
  if (!Array.isArray(hooks)) throw new Error(`"hooks" in ${file} must be an array`);
  return hooks;
}

/** Replaces the top-level `hooks:` array (key removed when the array becomes
 *  empty), preserving every other key verbatim. */
export async function writeHooksFile(file: string, hooks: unknown[]): Promise<void> {
  const doc = (await readDocument(file)) ?? {};
  if (hooks.length === 0) delete doc.hooks;
  else doc.hooks = hooks;
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temp, stringify(doc), "utf8");
    await fs.rename(temp, file);
  } finally {
    await fs.rm(temp, { force: true });
  }
}
