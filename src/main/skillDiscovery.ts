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

/** Parses one external subdirectory into a discovery entry; null = skipped. */
async function discoverEntry(
  origin: string,
  dir: string,
  entry: string,
  importedNames: Set<string>,
): Promise<DiscoveredSkill | null> {
  const sourceDir = path.join(dir, entry);
  const stat = await fs.stat(sourceDir).catch(() => null);
  if (!stat?.isDirectory()) return null;
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

/** Recursively copies a directory tree (Node fs, explicit UTF-8 for text). */
async function copyDir(source: string, target: string): Promise<void> {
  await fs.mkdir(target, { recursive: true });
  for (const entry of await fs.readdir(source)) {
    const from = path.join(source, entry);
    const to = path.join(target, entry);
    const stat = await fs.stat(from);
    if (stat.isDirectory()) {
      await copyDir(from, to);
    } else {
      await fs.copyFile(from, to);
    }
  }
}

/**
 * Copies a discovered skill into the user skills root. A name collision in
 * the target gets the "-imported" suffix (first free slot). Failures
 * (unreadable source, etc.) propagate to the caller for user feedback.
 */
export async function importSkill(
  discovered: DiscoveredSkill,
  targetRoot?: string,
  homedir: string = os.homedir(),
): Promise<void> {
  const root = targetRoot ?? userSkillsRoot(homedir);
  let name = discovered.name;
  if (await fs.stat(path.join(root, name)).catch(() => null)) {
    name = `${discovered.name}-imported`;
    let i = 2;
    while (await fs.stat(path.join(root, name)).catch(() => null)) {
      name = `${discovered.name}-imported-${i++}`;
    }
  }
  await copyDir(discovered.sourceDir, path.join(root, name));
}
