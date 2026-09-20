// 外部命令发现/导入：探测用户主目录下已知外部智能体目录中的扁平 *.md 命令
// （frontmatter 解析；无 frontmatter 降级为文件名即名、空描述；带 fence 但解析
// 失败的条目跳过），导入时把单文件复制到目标命令根（重名后缀 -imported）。
// 目录路径常量是依赖路径豁免；注释与 UI 文案保持中性（"外部智能体目录"）。
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseSkillMarkdown } from "@innocenceharness/plugin-skills";
import { importManagedCommand } from "@innocenceharness/plugin-skills/commandManagement";

/** A command discovered in a known external agent directory. */
export interface DiscoveredCommand {
  /** 命令名（frontmatter name；无 frontmatter 时回落文件名去扩展名）。 */
  name: string;
  /** 命令描述（frontmatter description；降级条目为空串）。 */
  description: string;
  /** 命令文件的绝对路径。 */
  sourceFile: string;
  /** 来源外部目录的中性标识（如 "external-a"）。 */
  origin: string;
  /** 目标用户命令根是否已有同名文件（<name>.md）。 */
  imported: boolean;
}

/** Known external agent command roots under the home directory (path constants
 *  are dependency-path exemptions; user-facing copy stays neutral). */
export function externalCommandRoots(homedir: string = os.homedir()): { origin: string; dir: string }[] {
  return [
    { origin: "external-a", dir: path.join(homedir, ".claude", "commands") },
    { origin: "external-b", dir: path.join(homedir, ".agents", "commands") },
  ];
}

/** Import destination: the user-level commands root. */
export function userCommandsRoot(homedir: string = os.homedir()): string {
  return path.join(homedir, ".innocence", "commands");
}

/** Parses one external *.md file into a discovery entry; null = skipped. */
async function discoverEntry(
  origin: string,
  dir: string,
  entry: string,
  importedFiles: Set<string>,
): Promise<DiscoveredCommand | null> {
  if (entry.startsWith(".") || !entry.endsWith(".md")) return null;
  const sourceFile = path.join(dir, entry);
  const stat = await fs.lstat(sourceFile).catch(() => null);
  if (!stat?.isFile() || stat.isSymbolicLink()) return null;
  const raw = await fs.readFile(sourceFile, "utf8").catch(() => null);
  if (raw === null) return null;
  const parsed = parseSkillMarkdown(raw);
  if (!parsed && raw.startsWith("---")) return null; // 带 fence 但解析失败 = 坏格式，跳过
  const name = parsed?.name ?? path.basename(entry, ".md");
  return {
    name,
    description: parsed?.description ?? "",
    sourceFile,
    origin,
    imported: importedFiles.has(`${name}.md`),
  };
}

/**
 * Probes the known external agent directories and returns every readable
 * command entry. Unreadable files and missing directories are skipped, not
 * fatal.
 */
export async function discoverExternalCommands(homedir: string = os.homedir()): Promise<DiscoveredCommand[]> {
  const importedFiles = new Set(
    await fs.readdir(userCommandsRoot(homedir)).catch(() => [] as string[]),
  );
  const results: DiscoveredCommand[] = [];
  for (const { origin, dir } of externalCommandRoots(homedir)) {
    const entries = await fs.readdir(dir).catch(() => [] as string[]);
    for (const entry of entries) {
      const discovered = await discoverEntry(origin, dir, entry, importedFiles);
      if (discovered) results.push(discovered);
    }
  }
  return results;
}

/** Validates a command name (plain specifier semantics: no separators, no dot
 *  prefix, no drive-letter prefix — aligned with the kernel loader's rule). */
function assertValidCommandName(name: string): void {
  if (
    !name ||
    name.startsWith(".") ||
    name.includes("/") ||
    name.includes("\\") ||
    /^[a-zA-Z]:/.test(name)
  ) {
    throw new Error(`invalid command name: ${JSON.stringify(name)}`);
  }
}

/** Whether resolved is inside root (resolve guards traversal suffixes). */
function isInsideRoot(resolved: string, root: string): boolean {
  return resolved === root || resolved.startsWith(root + path.sep);
}

const unsafeSourceError = "command source outside known roots";

function importedName(commandName: string, collisionCount: number): string {
  if (collisionCount === 0) return commandName;
  if (collisionCount === 1) return `${commandName}-imported`;
  return `${commandName}-imported-${collisionCount}`;
}

/**
 * Copies a discovered command file into the target commands root. A name
 * collision in the target gets the "-imported" suffix (first free slot).
 * The source must be a real file inside the known external roots (symlink
 * and traversal attempts are rejected); the no-overwrite single-file copy
 * itself is the package's importManagedCommand primitive. Failures propagate
 * to the caller for user feedback.
 */
export async function importCommand(
  discovered: DiscoveredCommand,
  targetRoot?: string,
  homedir: string = os.homedir(),
): Promise<void> {
  const root = targetRoot ?? userCommandsRoot(homedir);
  assertValidCommandName(discovered.name);
  const canonicalRoots = (
    await Promise.all(externalCommandRoots(homedir).map((r) => fs.realpath(r.dir).catch(() => null)))
  ).filter((dir): dir is string => dir !== null);
  const stat = await fs.lstat(discovered.sourceFile).catch(() => null);
  if (!stat?.isFile() || stat.isSymbolicLink()) throw new Error(unsafeSourceError);
  const resolved = await fs.realpath(discovered.sourceFile).catch(() => null);
  if (!resolved || !canonicalRoots.some((known) => isInsideRoot(resolved, known))) {
    throw new Error(unsafeSourceError);
  }
  const finalStat = await fs.lstat(discovered.sourceFile).catch(() => null);
  if (!finalStat?.isFile() || finalStat.isSymbolicLink()) throw new Error(unsafeSourceError);
  for (let collisionCount = 0; ; collisionCount++) {
    try {
      await importManagedCommand(root, resolved, importedName(discovered.name, collisionCount));
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
  }
}
