import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, existsSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInstallUserPluginTool } from "../src/installUserPlugin";

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "userplugins-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const ctx = { signal: new AbortController().signal } as never;

describe("install_user_plugin", () => {
  it("writes package.json + dist/index.js under the user root", async () => {
    const tool = createInstallUserPluginTool({ userRoot: root });
    const res = await tool.execute(
      { id: "my-tool", packageJson: "{\"name\":\"my-tool\"}", indexJs: "export default { name: 'my-tool', apply() {} };" },
      ctx,
    );
    expect(res.isError).toBeFalsy();
    expect(existsSync(join(root, "my-tool", "dist", "index.js"))).toBe(true);
    expect(readFileSync(join(root, "my-tool", "package.json"), "utf8")).toContain("my-tool");
  });

  it("rejects path-escape ids at the id gate, not by later guards", async () => {
    const tool = createInstallUserPluginTool({ userRoot: root });
    // 非空内容 + 错误文案断言：拦截必须来自 id 校验本身。若 id 校验放行
    // （如退回允许 ".." 的版本），".." 会落到覆写门控或空内容守卫，错误
    // 文案不同，此用例必须变红。
    for (const id of ["../evil", "a/b", "..", "a\\b", " ", ""]) {
      const res = await tool.execute(
        { id, packageJson: "{}", indexJs: "export default {};" },
        ctx,
      );
      expect(res.isError).toBe(true);
      expect(res.content).toContain("id 非法");
    }
  });

  it("never escapes the user root, even with overwrite requested", async () => {
    // 根外目录（tmpdir）快照：调用前后必须无新增条目——若 id 校验放行
    // ".."，本调用会直接在 tmpdir 写出 package.json 与 dist/。
    const parent = join(root, "..");
    const before = readdirSync(parent).sort();
    const tool = createInstallUserPluginTool({ userRoot: root });
    const res = await tool.execute(
      { id: "..", packageJson: "{}", indexJs: "x", overwrite: true },
      ctx,
    );
    expect(res.isError).toBe(true);
    expect(res.content).toContain("id 非法");
    expect(readdirSync(parent).sort()).toEqual(before);
  });

  it("refuses overwrite without the explicit flag", async () => {
    mkdirSync(join(root, "exists"), { recursive: true });
    const tool = createInstallUserPluginTool({ userRoot: root });
    const res = await tool.execute({ id: "exists", packageJson: "{}", indexJs: "" }, ctx);
    expect(res.isError).toBe(true);
    const ok = await tool.execute({ id: "exists", packageJson: "{}", indexJs: "x", overwrite: true }, ctx);
    expect(ok.isError).toBeFalsy();
  });
});
