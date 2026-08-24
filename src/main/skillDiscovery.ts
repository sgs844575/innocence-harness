// 外部技能发现/导入（任务 4）：探测用户主目录下已知外部智能体目录中的
// 技能（每子目录含 SKILL.md 即条目；畸形条目降级跳过），导入时把目录复制
// 到用户技能根 ~/.innocence/skills/<name>（重名后缀 -imported）。目录路径
// 常量是依赖路径豁免；注释与 UI 文案保持中性（"外部智能体目录"）。
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/** A skill discovered in a known external agent directory. */
export interface DiscoveredSkill {
  /** 技能名（SKILL.md frontmatter name；目录无条目时回落目录名）。 */
  name: string;
  /** 技能描述（frontmatter description）。 */
  description: string;
  /** 技能所在目录的绝对路径。 */
  sourceDir: string;
  /** 来源外部目录的中性标识（如 "external-a"）。 */
  origin: string;
  /** 是否已存在于目标用户技能根。 */
  imported: boolean;
}

/** Known external agent skill roots under the home directory (path constants
 *  are dependency-path exemptions; user-facing copy stays neutral). */
export function externalSkillRoots(homedir: string = os.homedir()): { origin: string; dir: string }[] {
  return [
    { origin: "external-a", dir: path.join(homedir, ".claude", "skills") },
    { origin: "external-b", dir: path.join(homedir, ".agents", "skills") },
  ];
}

/** Import destination: the user-level skills root. */
export function userSkillsRoot(homedir: string = os.homedir()): string {
  return path.join(homedir, ".innocence", "skills");
}

type SkillFsPort = {
  lstat: typeof fs.lstat;
  realpath: typeof fs.realpath;
  mkdir: typeof fs.mkdir;
  rm: typeof fs.rm;
  /** True only for an adapter that proves no-follow reads and no-replace publish. */
  supportsSecureImport: boolean;
  readdirNoFollow: typeof fs.readdir;
  copyFileNoFollow: typeof fs.copyFile;
  publishDirectoryNoReplace: (from: string, to: string) => Promise<void>;
  beforeRecursiveEntry?: (from: string) => Promise<void>;
};

type CopyContext = {
  sourceDir: string;
  canonicalSource: string;
  canonicalRoots: readonly string[];
};

const unsafeSourceError = "skill source outside known roots";
const unsupportedImportError = "skill import unavailable on this platform";

/**
 * Node's standard path-based fs/promises operations do not provide the
 * no-follow and no-replace primitives required by this importer on the
 * supported desktop runtime. Keep the production entry point fail-closed
 * until a host adapter with those proofs is installed. Tests inject a private
 * adapter implementing the same contract.
 */
const defaultFsPort: SkillFsPort = {
  lstat: fs.lstat,
  realpath: fs.realpath,
  mkdir: fs.mkdir,
  rm: fs.rm,
  supportsSecureImport: false,
  readdirNoFollow: async () => {
    throw new Error(unsupportedImportError);
  },
  copyFileNoFollow: async () => {
    throw new Error(unsupportedImportError);
  },
  publishDirectoryNoReplace: async () => {
    throw new Error(unsupportedImportError);
  },
};

/** Parses one external subdirectory into a discovery entry; null = skipped. */
async function discoverEntry(
  origin: string,
  dir: string,
  entry: string,
  importedNames: Set<string>,
): Promise<DiscoveredSkill | null> {
  const sourceDir = path.join(dir, entry);
  const stat = await fs.lstat(sourceDir).catch(() => null);
  if (!stat?.isDirectory() || stat.isSymbolicLink()) return null;
  const raw = await fs.readFile(path.join(sourceDir, "SKILL.md"), "utf8").catch(() => null);
  if (raw === null) return null;
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(raw);
  if (!match) return null;
  const name = /^name:\s*(.+)$/m.exec(match[1])?.[1]?.trim();
  const description = /^description:\s*(.+)$/m.exec(match[1])?.[1]?.trim();
  if (!name || !description) return null; // malformed — degraded skip
  return {
    name,
    description,
    sourceDir,
    origin,
    imported: importedNames.has(name),
  };
}

/**
 * Probes the known external agent directories and returns every parseable
 * skill entry. Malformed entries (no/invalid SKILL.md frontmatter) and
 * missing directories are skipped, not fatal.
 */
export async function discoverExternalSkills(homedir: string = os.homedir()): Promise<DiscoveredSkill[]> {
  const targetRoot = userSkillsRoot(homedir);
  const importedNames = new Set(
    await fs.readdir(targetRoot).catch(() => [] as string[]),
  );
  const results: DiscoveredSkill[] = [];
  for (const { origin, dir } of externalSkillRoots(homedir)) {
    const entries = await fs.readdir(dir).catch(() => [] as string[]);
    for (const entry of entries) {
      const discovered = await discoverEntry(origin, dir, entry, importedNames);
      if (discovered) results.push(discovered);
    }
  }
  return results;
}

/** Validates a skill name (plain specifier semantics: no separators, no dot
 *  prefix, no drive-letter prefix — aligned with the kernel loader's rule). */
function assertValidSkillName(name: string): void {
  if (
    !name ||
    name.startsWith(".") ||
    name.includes("/") ||
    name.includes("\\") ||
    /^[a-zA-Z]:/.test(name)
  ) {
    throw new Error(`invalid skill name: ${JSON.stringify(name)}`);
  }
}

/** Whether resolved is inside root (resolve guards traversal suffixes). */
function isInsideRoot(resolved: string, root: string): boolean {
  return resolved === root || resolved.startsWith(root + path.sep);
}

async function validateSourceDir(
  sourceDir: string,
  knownRoots: readonly (string | null)[],
  fsPort: SkillFsPort,
): Promise<CopyContext> {
  const stat = await fsPort.lstat(sourceDir).catch(() => null);
  if (!stat || !stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(unsafeSourceError);
  }
  const canonicalRoots = knownRoots.filter((root): root is string => root !== null);
  const resolvedSource = await fsPort.realpath(sourceDir).catch(() => null);
  if (
    !resolvedSource
    || !canonicalRoots.some((root) => isInsideRoot(resolvedSource, root))
  ) {
    throw new Error(unsafeSourceError);
  }
  const finalStat = await fsPort.lstat(sourceDir).catch(() => null);
  if (!finalStat || !finalStat.isDirectory() || finalStat.isSymbolicLink()) {
    throw new Error(unsafeSourceError);
  }
  return { sourceDir, canonicalSource: resolvedSource, canonicalRoots };
}

async function assertDirectoryInsideRoots(
  source: string,
  context: CopyContext,
  fsPort: SkillFsPort,
): Promise<string> {
  const stat = await fsPort.lstat(source).catch(() => null);
  if (!stat || !stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(unsafeSourceError);
  }
  const resolved = await fsPort.realpath(source).catch(() => null);
  if (
    !resolved
    || !isInsideRoot(resolved, context.canonicalSource)
    || !context.canonicalRoots.some((root) => isInsideRoot(resolved, root))
  ) {
    throw new Error(unsafeSourceError);
  }
  const finalStat = await fsPort.lstat(source).catch(() => null);
  const finalResolved = await fsPort.realpath(source).catch(() => null);
  if (
    !finalStat
    || !finalStat.isDirectory()
    || finalStat.isSymbolicLink()
    || finalResolved !== resolved
  ) {
    throw new Error(unsafeSourceError);
  }
  return resolved;
}

async function assertFileInsideRoots(
  source: string,
  context: CopyContext,
  fsPort: SkillFsPort,
): Promise<void> {
  const stat = await fsPort.lstat(source).catch(() => null);
  if (!stat || !stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(unsafeSourceError);
  }
  const resolved = await fsPort.realpath(source).catch(() => null);
  if (
    !resolved
    || !isInsideRoot(resolved, context.canonicalSource)
    || !context.canonicalRoots.some((root) => isInsideRoot(resolved, root))
  ) {
    throw new Error(unsafeSourceError);
  }
  const finalStat = await fsPort.lstat(source).catch(() => null);
  const finalResolved = await fsPort.realpath(source).catch(() => null);
  if (
    !finalStat
    || !finalStat.isFile()
    || finalStat.isSymbolicLink()
    || finalResolved !== resolved
  ) {
    throw new Error(unsafeSourceError);
  }
}

async function copyDir(
  source: string,
  target: string,
  context: CopyContext,
  fsPort: SkillFsPort,
  visited: Set<string>,
  checked = false,
): Promise<void> {
  if (!checked) await fsPort.beforeRecursiveEntry?.(source);
  const canonical = await assertDirectoryInsideRoots(source, context, fsPort);
  if (source === context.sourceDir && canonical !== context.canonicalSource) {
    throw new Error(unsafeSourceError);
  }
  if (!isInsideRoot(canonical, context.canonicalSource)) {
    throw new Error(unsafeSourceError);
  }
  if (visited.has(canonical)) return;
  visited.add(canonical);
  await fsPort.mkdir(target, { recursive: true });
  const entries = await fsPort.readdirNoFollow(source);
  const currentCanonical = await assertDirectoryInsideRoots(source, context, fsPort);
  if (currentCanonical !== canonical) throw new Error(unsafeSourceError);
  for (const entry of entries) {
    const from = path.join(source, entry);
    const to = path.join(target, entry);
    const before = await fsPort.lstat(from);
    if (before.isSymbolicLink()) continue;
    await fsPort.beforeRecursiveEntry?.(from);
    const after = await fsPort.lstat(from).catch(() => null);
    if (
      !after
      || after.isSymbolicLink()
      || after.isDirectory() !== before.isDirectory()
    ) {
      throw new Error(unsafeSourceError);
    }
    if (after.isDirectory()) {
      await copyDir(from, to, context, fsPort, visited, true);
      continue;
    }
    await assertFileInsideRoots(from, context, fsPort);
    await fsPort.copyFileNoFollow(from, to);
    await assertFileInsideRoots(from, context, fsPort);
  }
}

async function readExisting(
  target: string,
  fsPort: SkillFsPort,
): Promise<boolean> {
  const stat = await fsPort.lstat(target).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  });
  return stat !== null;
}

async function createTempDirectory(
  root: string,
  name: string,
  fsPort: SkillFsPort,
): Promise<string> {
  for (let attempt = 0; ; attempt++) {
    const temp = path.join(
      root,
      `.${name}.importing-${Date.now().toString(36)}-${attempt.toString(36)}`,
    );
    try {
      await fsPort.mkdir(temp);
      return temp;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
  }
}

function importedName(skillName: string, collisionCount: number): string {
  if (collisionCount === 0) return skillName;
  if (collisionCount === 1) return `${skillName}-imported`;
  return `${skillName}-imported-${collisionCount}`;
}

function isTargetCollision(error: unknown): boolean {
  return ["EEXIST", "ENOTEMPTY", "EPERM"].includes((error as NodeJS.ErrnoException).code ?? "");
}

/**
 * Copies a discovered skill into the user skills root. A name collision in
 * the target gets the "-imported" suffix (first free slot). Failures
 * (unreadable source, etc.) propagate to the caller for user feedback.
 */
export function importSkill(
  discovered: DiscoveredSkill,
  targetRoot?: string,
  homedir?: string,
): Promise<void>;
export async function importSkill(
  discovered: DiscoveredSkill,
  targetRoot?: string,
  homedir: string = os.homedir(),
  fsPort: SkillFsPort = defaultFsPort,
): Promise<void> {
  const root = targetRoot ?? userSkillsRoot(homedir);
  if (!fsPort.supportsSecureImport) throw new Error(unsupportedImportError);
  assertValidSkillName(discovered.name);
  const knownRoots = await Promise.all(
    externalSkillRoots(homedir).map(async (r) => fsPort.realpath(r.dir).catch(() => null)),
  );
  const context = await validateSourceDir(discovered.sourceDir, knownRoots, fsPort);
  await fsPort.mkdir(root, { recursive: true });

  let collisionCount = 0;
  for (;;) {
    const name = importedName(discovered.name, collisionCount);
    if (await readExisting(path.join(root, name), fsPort)) {
      collisionCount++;
      continue;
    }
    const temp = await createTempDirectory(root, name, fsPort);
    let published = false;
    try {
      await copyDir(context.sourceDir, temp, context, fsPort, new Set());
      const tempStat = await fsPort.lstat(temp);
      if (!tempStat.isDirectory() || tempStat.isSymbolicLink()) {
        throw new Error(unsafeSourceError);
      }
      const target = path.join(root, name);
      if (await readExisting(target, fsPort)) {
        collisionCount++;
        continue;
      }
      try {
        await fsPort.publishDirectoryNoReplace(temp, target);
        published = true;
        return;
      } catch (error) {
        if (!isTargetCollision(error) || !(await readExisting(target, fsPort))) throw error;
        collisionCount++;
      }
    } finally {
      if (!published) await fsPort.rm(temp, { recursive: true, force: true });
    }
  }
}
