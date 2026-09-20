import { constants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { parseSkillMarkdown } from "./index";

/** A flat-file slash command (`<root>/<id>.md` with SKILL.md-style frontmatter). */
export interface ManagedCommand { id: string; name: string; description: string }

const valid = (id: string) => {
  if (!id || id.startsWith(".") || /[/\\:]/.test(id) || path.basename(id) !== id) throw new Error("Invalid command identifier.");
};

/**
 * Lists the flat `*.md` commands under root: dotfiles, symlinks and
 * non-files are skipped; a file whose frontmatter does not parse degrades to
 * the filename-as-name projection with an empty description (never fatal).
 * Output is name-sorted for a stable settings listing.
 */
export async function listManagedCommands(root: string): Promise<ManagedCommand[]> {
  const rows: ManagedCommand[] = [];
  for (const entry of await fs.readdir(root).catch(() => [] as string[])) {
    if (entry.startsWith(".") || !entry.endsWith(".md")) continue;
    const file = path.join(root, entry);
    const stat = await fs.lstat(file).catch(() => null);
    if (!stat?.isFile() || stat.isSymbolicLink()) continue;
    const id = entry.slice(0, -".md".length);
    const parsed = parseSkillMarkdown(await fs.readFile(file, "utf8").catch(() => ""));
    rows.push(parsed ? { id, name: parsed.name, description: parsed.description } : { id, name: id, description: "" });
  }
  return rows.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Writes `<root>/<id>.md` with frontmatter (name mirrors the id; scalar
 * values are JSON-quoted so any description survives the YAML round-trip).
 * Refuses to overwrite an existing file; the root is created first.
 */
export async function createManagedCommand(root: string, input: { id: string; description: string; body: string }): Promise<void> {
  valid(input.id);
  await fs.mkdir(root, { recursive: true });
  const raw = `---\nname: ${JSON.stringify(input.id)}\ndescription: ${JSON.stringify(input.description)}\n---\n\n${input.body.trim()}\n`;
  await fs.writeFile(path.join(root, `${input.id}.md`), raw, { encoding: "utf8", flag: "wx" });
}

async function owned(root: string, id: string): Promise<string> {
  valid(id);
  const file = path.join(root, `${id}.md`);
  const stat = await fs.lstat(file).catch(() => null);
  if (!stat?.isFile() || stat.isSymbolicLink()) throw new Error("Command is not an owned file.");
  return file;
}

export async function removeManagedCommand(root: string, id: string): Promise<void> {
  await fs.rm(await owned(root, id));
}

/** Single-file import: the source must be a real file (never a symlink); the
 *  target never overwrites an existing command. */
export async function importManagedCommand(root: string, sourceFile: string, id: string): Promise<void> {
  valid(id);
  const stat = await fs.lstat(sourceFile).catch(() => null);
  if (!stat?.isFile() || stat.isSymbolicLink()) throw new Error("Invalid command source.");
  await fs.mkdir(root, { recursive: true });
  await fs.copyFile(sourceFile, path.join(root, `${id}.md`), constants.COPYFILE_EXCL);
}
