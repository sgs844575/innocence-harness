import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { copyManagedSkill, listManagedSkills, removeManagedSkill, setSkillEnabled } from "../src/management";
import { scanSkillCatalog } from "../src";
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((r) => fs.rm(r, { recursive: true, force: true }))); });
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "skill-management-")); roots.push(root);
  const source = path.join(root, "source"); await fs.mkdir(source);
  await fs.writeFile(path.join(source, "SKILL.md"), "---\nname: sample\ndescription: Sample workflow\n---\nFollow the steps.", "utf8");
  return { root: path.join(root, "skills"), source };
}
describe("skill management", () => {
  it("copies supporting files, respects disable state in runtime scans, and removes only the selected copy", async () => {
    const { root, source } = await fixture();
    await fs.writeFile(path.join(source, "helper.txt"), "support", "utf8");
    await copyManagedSkill(root, source, "sample");
    expect(await fs.readFile(path.join(root, "sample/helper.txt"), "utf8")).toBe("support");
    expect(await scanSkillCatalog([root])).toHaveLength(1);
    await setSkillEnabled(root, "sample", false);
    expect(await scanSkillCatalog([root])).toEqual([]);
    expect(await listManagedSkills(root)).toEqual([expect.objectContaining({ name: "sample", enabled: false })]);
    await setSkillEnabled(root, "sample", true);
    expect(await scanSkillCatalog([root])).toHaveLength(1);
    await expect(copyManagedSkill(root, source, "sample")).rejects.toThrow();
    await expect(removeManagedSkill(root, "../source")).rejects.toThrow();
    await removeManagedSkill(root, "sample");
    expect(await listManagedSkills(root)).toEqual([]);
    expect(await fs.stat(path.join(source, "SKILL.md"))).toBeTruthy();
  });
});
