// composePlugins 集成（spec 4）：项目 plugins.yml + 用户开关 →
// resolvePluginSet（本地拷贝）→ 按清单 id 从 staging 双根磁盘装载。
// T11 起组合根经 pluginBoot（动态 staging 内核 + FileModuleResolver）装
// 配，T12 起组合逻辑位于 pluginBoot/sessionComposition（Electron-free，
// 测试直接以 staging 路径构造，不再需要 electron mock）；测试因此需要
// 真实 staging 树（npm run build:plugins 产出）；无 staging 的干净检出按
// packaged-exit 先例设计性跳过。
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createSessionComposition } from "./pluginBoot";
import { stagingBootPaths } from "./staging-paths";

const stagingAvailable = existsSync(stagingBootPaths().kernelPath);
const maybeDescribe = stagingAvailable ? describe : describe.skip;

const composition = createSessionComposition({
  resolvePaths: stagingBootPaths,
  getWorkspaceRoot: () => undefined,
  // 密闭性：composePlugins 现算扫描用户根，组合级计数断言不得依赖开发机
  // 的 ~/.innocence/plugins 内容——钉死为不存在的路径（扫描结果恒空）。
  getUserPluginRoot: () => path.join(tmpdir(), "ic-compose-no-user-plugins"),
  log: () => {},
});
const composePlugins = (workspaceRoot: string, userToggles?: { subagent?: boolean; skills?: boolean; mcp?: boolean; todo?: boolean }) =>
  composition.composePlugins(workspaceRoot, userToggles);

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

async function tempWorkspace(files: Record<string, string>): Promise<string> {
  const root = mkdtempSync(path.join(tmpdir(), "ic-compose-"));
  roots.push(root);
  for (const [rel, content] of Object.entries(files)) {
    const file = path.join(root, rel);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, content, "utf8");
  }
  return root;
}

// staging manifest 的清单 id 集：能力插件（内核原生插件，name 与 id 同名
// 且有实例化分支——agent-default 直装载默认导出，agent-creation 默认导出
// 是工厂、由宿主 factoryPlugin 装配）+ example（渲染层示例插件：仅清单/
// 投影面，无会话实例化分支）。provider/task 等由组合层另行装配不进清单。
const MANIFEST_IDS = [
  "fs", "shell", "subagent", "skills", "mcp", "ssh", "archive", "todo",
  "agent-default", "agent-creation",
] as const;
const INVENTORY_IDS = [...MANIFEST_IDS, "example"] as const;

maybeDescribe("composePlugins (declarative composition root)", () => {
  it("project yml wins, user toggles apply, core stays, todo registers", async () => {
    const ws = await tempWorkspace({ ".innocence/plugins.yml": "plugins:\n  mcp: false\n" });
    const names = (await composePlugins(ws, { subagent: false })).map((p) => p.name);
    expect(names).toContain("fs");
    expect(names).toContain("shell");
    expect(names).toContain("project-permission-rules");
    expect(names).toContain("todo");
    expect(names).toContain("skills"); // 未关的开关全部在场
    expect(names).not.toContain("mcp");
    expect(names).not.toContain("subagent");
  });

  it("skills:false omits the skills plugin; core stays on", async () => {
    const ws = await tempWorkspace({ ".innocence/plugins.yml": "plugins:\n  skills: false\n" });
    const names = (await composePlugins(ws)).map((p) => p.name);
    expect(names).not.toContain("skills");
    expect(names).toContain("fs");
    expect(names).toContain("todo");
  });

  it("guard: manifest ids and instantiation branches stay 1:1", async () => {
    const ws = await tempWorkspace({});
    const names = (await composePlugins(ws)).map((p) => p.name);
    // 清单能力 id → 插件实例名；新增能力条目必须同步此映射与实例化分支
    // （example 例外：渲染层示例插件，无会话装配，仅经清单投影驱动 client）。
    const nameById: Record<string, string> = {
      fs: "fs",
      shell: "shell",
      subagent: "subagent",
      skills: "skills",
      mcp: "mcp",
      ssh: "ssh",
      archive: "archive",
      todo: "todo",
      "agent-default": "agent-default",
      "agent-creation": "agent-creation",
    };
    for (const id of MANIFEST_IDS) {
      expect(nameById[id], `descriptor "${id}" 缺少测试侧 id→name 映射`).toBeTruthy();
      expect(names, `descriptor "${id}" 未实例化`).toContain(nameById[id]);
    }
    // +2 = project-permission-rules（关系模型外，恒定注入）与 provider（设置
    // 驱动的 provider 插件，每 session 组装）；多余的实例化分支（无对应
    // 描述符）同样会让计数失衡变红。
    expect(names).toContain("project-permission-rules");
    expect(names).toContain("provider");
    expect(names).toHaveLength(MANIFEST_IDS.length + 2);
  });

  it("equivalence: composePlugins names mirror resolveBuiltinSet active entries", async () => {
    // T2 等价升级披露：装载中间态（importPlugin+plugins 数组）保持不变，
    // 但其输入驱动面收敛为 resolveEntries 产出——同一 toggles 下，session
    // 插件名集与 active 条目集一致（1:1 守卫的条目面镜像）。
    const ws = await tempWorkspace({ ".innocence/plugins.yml": "plugins:\n  mcp: false\n" });
    const boot = await composition.ensureBoot();
    const resolved = await boot.resolveBuiltinSet({ workspaceRoot: ws, userToggles: { subagent: false } });
    const names = (await composePlugins(ws, { subagent: false })).map((p) => p.name);
    for (const entry of resolved.entries) {
      if (entry.disabled) expect(names).not.toContain(entry.id);
      else if (entry.id !== "example") expect(names).toContain(entry.id);
    }
    expect(resolved.active).not.toContain("mcp");
    expect(resolved.active).not.toContain("subagent");
  });

  it("staging manifest 快照：agent 模式插件登记（kind agent-mode、非 core、无依赖）", () => {
    const manifest = JSON.parse(
      readFileSync(path.join(stagingBootPaths().builtinRoot, "manifest.json"), "utf8"),
    ) as { plugins: Array<{ id: string; kind?: string; core?: boolean; dependencies?: string[] }> };
    const byId = new Map(manifest.plugins.map((entry) => [entry.id, entry]));
    for (const id of ["agent-default", "agent-creation"]) {
      const entry = byId.get(id);
      expect(entry, `manifest 缺少 "${id}" 条目`).toBeDefined();
      expect(entry).toMatchObject({ kind: "agent-mode", dependencies: [] });
      expect(entry?.core ?? false, `"${id}" 必须非 core（可开关）`).toBe(false);
    }
  });

  // ---- pluginInventory（清单投影，PluginsSection 数据源）------------------

  it("inventory 默认全 active：按清单序、title 非空、core/client 标记齐全", async () => {
    const ws = await tempWorkspace({});
    const entries = await composition.pluginInventory({ workspaceRoot: ws });
    expect(entries.map((e) => e.id)).toEqual([...INVENTORY_IDS]);
    for (const entry of entries) {
      expect(entry.title, `"${entry.id}" 缺 title`).toMatch(/\S/);
      expect(typeof entry.client).toBe("boolean");
      expect(entry.state).toBe("active");
      expect(entry.via).toBe("default");
    }
    const byId = new Map(entries.map((e) => [e.id, e]));
    expect(byId.get("fs")?.core).toBe(true);
    expect(byId.get("shell")?.core).toBe(true);
    expect(byId.get("mcp")?.core).toBe(false);
    // example：渲染层示例插件——client 标记为真（dist/client.js 产出），
    // 是 webview 侧 client 装载链（innocenceharness-plugin://example/dist/client.js）的数据源。
    expect(byId.get("example")).toMatchObject({ core: false, client: true, state: "active", via: "default" });
  });

  it("inventory 按当前 toggles 现算：用户关 mcp → disabled-by-config/user，项目 yml 关 subagent → via project", async () => {
    const ws = await tempWorkspace({ ".innocence/plugins.yml": "plugins:\n  subagent: false\n" });
    const entries = await composition.pluginInventory({
      workspaceRoot: ws,
      userToggles: { mcp: false },
    });
    const byId = new Map(entries.map((e) => [e.id, e]));
    expect(byId.get("mcp")).toMatchObject({ state: "disabled-by-config", via: "user" });
    expect(byId.get("subagent")).toMatchObject({ state: "disabled-by-config", via: "project" });
    expect(byId.get("skills")).toMatchObject({ state: "active" });
  });

  it("inventory 每次调用重跑解析（非 boot 快照）：改 toggles 立即反映", async () => {
    const ws = await tempWorkspace({});
    const before = await composition.pluginInventory({ workspaceRoot: ws, userToggles: { skills: false } });
    expect(before.find((e) => e.id === "skills")?.state).toBe("disabled-by-config");
    const after = await composition.pluginInventory({ workspaceRoot: ws });
    expect(after.find((e) => e.id === "skills")?.state).toBe("active");
  });

  it("inventory 空工作区无项目层：只看用户开关，不读 cwd 级 plugins.yml", async () => {
    const entries = await composition.pluginInventory({ workspaceRoot: "", userToggles: { todo: false } });
    expect(entries.find((e) => e.id === "todo")).toMatchObject({
      state: "disabled-by-config",
      via: "user",
    });
    expect(entries.find((e) => e.id === "mcp")?.state).toBe("active");
  });
});

// ---- 用户根扫描并入装配（任务 13）----------------------------------------
// 独立组合根：getUserPluginRoot 指向伪用户根（原生格式目录），验证扫描描
// 述符并入 composePlugins 产出、manifest id 冲突时清单胜出、扫描告警进
// 宿主日志，以及 agents:modes 目录投影（readManifest kind 透传端到端）。
maybeDescribe("composePlugins user-root scan merge", () => {
  function scanComposition(userPlugins: Record<string, Record<string, unknown>>) {
    const userRoot = mkdtempSync(path.join(tmpdir(), "ic-user-plugins-"));
    roots.push(userRoot);
    for (const [id, pkg] of Object.entries(userPlugins)) {
      mkdirSync(path.join(userRoot, id, "dist"), { recursive: true });
      writeFileSync(path.join(userRoot, id, "package.json"), JSON.stringify(pkg), "utf8");
      writeFileSync(
        path.join(userRoot, id, "dist", "index.js"),
        `export default { name: ${JSON.stringify(id)}, apply() {} };`,
        "utf8",
      );
    }
    return createSessionComposition({
      resolvePaths: stagingBootPaths,
      getWorkspaceRoot: () => undefined,
      getUserPluginRoot: () => userRoot,
      enableHmrWatcher: false,
      log: () => {},
    });
  }

  it("scanned native user plugins join the composed session entries", async () => {
    const composition = scanComposition({
      "my-user-mode": { name: "my-user-mode", innocenceharness: { agentMode: { title: "My User Mode" } } },
    });
    try {
      const ws = await tempWorkspace({});
      const names = (await composition.composePlugins(ws)).map((p) => p.name);
      expect(names.filter((n) => n === "my-user-mode")).toHaveLength(1);
      expect(names).toContain("fs"); // 内置集不受扫描并入影响
    } finally {
      await composition.disposePluginBoot();
    }
  });

  it("manifest descriptor wins on id collision: single entry, manifest toggle semantics", async () => {
    const composition = scanComposition({
      // 与清单同 id：manifest 描述符胜出——条目唯一，toggle 语义随 manifest
      // （用户目录对模块本体的影子覆盖由 resolver 根序保证，不在此复活）。
      mcp: { name: "mcp", innocenceharness: { agentMode: { title: "Shadow MCP" } } },
    });
    try {
      const ws = await tempWorkspace({});
      const on = (await composition.composePlugins(ws)).map((p) => p.name);
      expect(on.filter((n) => n === "mcp")).toHaveLength(1);
      const off = (await composition.composePlugins(ws, { mcp: false })).map((p) => p.name);
      expect(off).not.toContain("mcp");
    } finally {
      await composition.disposePluginBoot();
    }
  });

  it("scan warnings surface through the composition log sink", async () => {
    const userRoot = mkdtempSync(path.join(tmpdir(), "ic-user-plugins-"));
    roots.push(userRoot);
    mkdirSync(path.join(userRoot, "no-format"), { recursive: true }); // 无已知格式 → 告警
    const logged: Array<[string, string, unknown]> = [];
    const composition = createSessionComposition({
      resolvePaths: stagingBootPaths,
      getWorkspaceRoot: () => undefined,
      getUserPluginRoot: () => userRoot,
      enableHmrWatcher: false,
      log: (level, msg, data) => logged.push([level, msg, data]),
    });
    try {
      const ws = await tempWorkspace({});
      await composition.composePlugins(ws);
      expect(logged).toContainEqual([
        "warn",
        "user plugin scan",
        { warning: expect.stringContaining("no known format") },
      ]);
    } finally {
      await composition.disposePluginBoot();
    }
  });

  it("agentModes: manifest kind passthrough + scanned user mode + default fallback", async () => {
    const composition = scanComposition({
      "my-user-mode": { name: "my-user-mode", innocenceharness: { agentMode: { title: "My User Mode" } } },
    });
    try {
      const modes = await composition.agentModes();
      const byId = new Map(modes.map((m) => [m.id, m]));
      // readManifest kind 透传端到端：内置模式插件经白名单重建仍带 kind，
      // 否则 agent-default/agent-creation 会从目录中消失。
      expect(byId.get("agent-default")).toBeDefined();
      expect(byId.get("agent-creation")).toBeDefined();
      // 扫描并入：用户模式进目录，title 取 package.json 投影。
      expect(byId.get("my-user-mode")).toMatchObject({ id: "my-user-mode", title: "My User Mode" });
      // 兜底恒在。
      expect(byId.get("default")).toEqual({ id: "default", title: "Default" });
    } finally {
      await composition.disposePluginBoot();
    }
  });
});

if (!stagingAvailable) {
  // A visible reason next to the skip (vitest shows it.skip without one).
  it.skip("staging tree not found — run `npm run build:plugins` then re-run to exercise the boot composition", () => {});
}
