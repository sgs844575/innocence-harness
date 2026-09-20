import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createWorkbench, listWorkbenches, removeWorkbench, touchWorkbench } from "./workbenchStore";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((r) => fs.rm(r, { recursive: true, force: true }))); });
async function fixture(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "innocence-workbench-"));
  roots.push(root);
  return path.join(root, "workbench");
}

describe("workbench store", () => {
  it("creates with a slugged unique id, starter page, and meta; lists newest first", async () => {
    const root = await fixture();
    const first = await createWorkbench("我的 面板", root);
    expect(first.id).toBe("workbench"); // 非拉丁名称回落固定 id
    expect(first.dir).toBe(path.join(root, "workbench"));
    const second = await createWorkbench("My Panel!", root);
    expect(second.id).toBe("my-panel");
    const third = await createWorkbench("my panel", root);
    expect(third.id).toBe("my-panel-2");
    const html = await fs.readFile(path.join(first.dir, "index.html"), "utf8");
    expect(html).toContain("<!doctype html>");
    await new Promise((resolve) => setTimeout(resolve, 5));
    await touchWorkbench(second.id, root);
    const listed = await listWorkbenches(root);
    expect(listed.map((row) => row.id)).toEqual(["my-panel", "my-panel-2", "workbench"]);
    expect(Date.parse(listed[0].updatedAt)).toBeGreaterThan(Date.parse(second.updatedAt));
  });

  it("skips malformed entries and rejects bad ids; remove deletes the directory", async () => {
    const root = await fixture();
    const created = await createWorkbench("notes", root);
    await fs.mkdir(path.join(root, "garbage"), { recursive: true }); // 无 meta
    await fs.mkdir(path.join(root, "bad"), { recursive: true });
    await fs.writeFile(path.join(root, "bad", "workbench.json"), "{ not json", "utf8");
    await fs.mkdir(path.join(root, "mismatch"), { recursive: true });
    await fs.writeFile(path.join(root, "mismatch", "workbench.json"), JSON.stringify({ id: "other", name: "x", createdAt: "a", updatedAt: "b" }), "utf8");
    expect((await listWorkbenches(root)).map((row) => row.id)).toEqual(["notes"]);
    await expect(createWorkbench("  ", root)).rejects.toThrow("Invalid workbench name");
    await expect(removeWorkbench("../notes", root)).rejects.toThrow("Invalid workbench id");
    await expect(touchWorkbench("ghost", root)).rejects.toThrow("Unknown workbench");
    await removeWorkbench(created.id, root);
    expect(await listWorkbenches(root)).toEqual([]);
  });
});
