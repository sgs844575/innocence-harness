import fs from "node:fs/promises";
import path from "node:path";
import { parseSkillMarkdown } from "./index";

export interface ManagedSkill { id: string; name: string; description: string; enabled: boolean }
const valid = (id: string) => {
  if (!id || id.startsWith(".") || /[/\\:]/.test(id) || path.basename(id) !== id) throw new Error("Invalid skill identifier.");
};
export async function listManagedSkills(root: string): Promise<ManagedSkill[]> {
  const rows: ManagedSkill[] = [];
  for (const id of await fs.readdir(root).catch(() => [] as string[])) {
    if (id.startsWith(".")) continue;
    const dir = path.join(root, id);
    const stat = await fs.lstat(dir);
    if (!stat.isDirectory() || stat.isSymbolicLink()) continue;
    const parsed = parseSkillMarkdown(await fs.readFile(path.join(dir, "SKILL.md"), "utf8").catch(() => ""));
    if (parsed) rows.push({ id, name: parsed.name, description: parsed.description, enabled: !(await fs.stat(path.join(dir, ".disabled")).catch(() => null)) });
  }
  return rows;
}
async function owned(root: string, id: string): Promise<string> {
  valid(id);
  const dir = path.join(root, id);
  const stat = await fs.lstat(dir);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Skill is not an owned directory.");
  return dir;
}
export async function setSkillEnabled(root: string, id: string, enabled: boolean): Promise<void> {
  const marker = path.join(await owned(root, id), ".disabled");
  if (enabled) await fs.rm(marker, { force: true });
  else await fs.writeFile(marker, "", { encoding: "utf8", flag: "wx" }).catch((error: NodeJS.ErrnoException) => { if (error.code !== "EEXIST") throw error; });
}
export async function removeManagedSkill(root: string, id: string): Promise<void> {
  await fs.rm(await owned(root, id), { recursive: true });
}
export async function copyManagedSkill(root: string, source: string, id: string): Promise<void> {
  valid(id);
  if (!(await fs.lstat(source)).isDirectory() || (await fs.lstat(source)).isSymbolicLink()) throw new Error("Invalid skill source.");
  await fs.mkdir(root, { recursive: true });
  const target = path.join(root, id);
  await fs.mkdir(target);
  try {
    for (const child of await fs.readdir(source)) await fs.cp(path.join(source, child), path.join(target, child), { recursive: true, force: false, errorOnExist: true, filter: async (entry) => {
      if ((await fs.lstat(entry)).isSymbolicLink()) throw new Error("Linked skill files cannot be imported.");
      return true;
    } });
  } catch (error) { await fs.rm(target, { recursive: true, force: true }); throw error; }
}
