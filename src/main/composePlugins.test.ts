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

import { DEFAULT_SETTINGS, AgentSession } from "@innocenceharness/harness-electron";
import { createMockProvider } from "@innocenceharness/provider-mock";
import type { MessageProcessor } from "@innocenceharness/harness-session";
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
// 且有实例化分支——default 直装载默认导出，creation 默认导出
// 是工厂、由宿主 factoryPlugin 装配）+ example（渲染层示例插件：仅清单/
// 投影面，无会话实例化分支）。provider/task 等由组合层另行装配不进清单。
// 模式插件的 staging id 必须等于其注册的 agent 模式 id（default/creation
// 与单模式插件 plan/focus/minimal/learning——learn 包注册 id 是 "learning"）。
// builtin-skills 为内置技能内容包：默认导出即插件对象（name 同 id），
// 向 skills 脊柱服务注册六个常驻技能。reminders 为消息侧提醒注入插件：
// 默认导出是工厂（同 creation 形态），由宿主 factoryPlugin 装配并传入
// settings 通道的许可档 getter（仿 creation 的映射与计数同步）。
// reference 为按需参考资料工具插件：默认导出即插件对象（name 同 id），
// 向 tools 服务注册只读 read_reference（四个内置参考条目的固定目录）。
const MANIFEST_IDS = [
  "fs", "shell", "subagent", "skills", "mcp", "ssh", "archive", "todo",
  "reference", "builtin-skills", "reminders",
  "default", "creation", "plan", "focus", "minimal", "learning",
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
      reference: "reference",
      "builtin-skills": "builtin-skills",
      reminders: "reminders",
      default: "default",
      creation: "creation",
      plan: "plan",
      focus: "focus",
      minimal: "minimal",
      learning: "learning",
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
    ) as { plugins: Array<{ id: string; kind?: string; core?: boolean; dependencies?: string[]; title?: string }> };
    const byId = new Map(manifest.plugins.map((entry) => [entry.id, entry]));
    // staging id 必须等于注册的 agent 模式 id（default/creation 与
    // plan/focus/minimal/learning）——切换器按清单 id 写设置、会话按注册 id
    // 解析提示词，此处锁死两侧的一致性命名。
    for (const id of ["default", "creation", "plan", "focus", "minimal", "learning"]) {
      const entry = byId.get(id);
      expect(entry, `manifest 缺少 "${id}" 条目`).toBeDefined();
      expect(entry).toMatchObject({ kind: "agent-mode", dependencies: [] });
      expect(entry?.core ?? false, `"${id}" 必须非 core（可开关）`).toBe(false);
    }
    // 内置技能内容包：能力插件（非 core、无依赖、无 kind），默认导出即
    // 插件对象——通用装载链直装载，name 与 staging id 同名。
    const builtinSkillsEntry = byId.get("builtin-skills");
    expect(builtinSkillsEntry, 'manifest 缺少 "builtin-skills" 条目').toBeDefined();
    expect(builtinSkillsEntry).toMatchObject({ dependencies: [] });
    expect(builtinSkillsEntry?.core ?? false, '"builtin-skills" 必须非 core（可开关）').toBe(false);
    expect(builtinSkillsEntry?.kind).toBeUndefined();
    expect(builtinSkillsEntry?.title, '"builtin-skills" 缺 title').toMatch(/\S/);
    // 按需参考资料工具插件：普通能力插件（非 core、无依赖、无 kind），
    // 默认导出即插件对象——通用装载链直装载，name 与 staging id 同名。
    const referenceEntry = byId.get("reference");
    expect(referenceEntry, 'manifest 缺少 "reference" 条目').toBeDefined();
    expect(referenceEntry).toMatchObject({ dependencies: [] });
    expect(referenceEntry?.core ?? false, '"reference" 必须非 core（可开关）').toBe(false);
    expect(referenceEntry?.kind).toBeUndefined();
    expect(referenceEntry?.title, '"reference" 缺 title').toMatch(/\S/);
    // 消息侧提醒注入插件：工厂型能力插件（非 core、无依赖、无 kind），
    // 由宿主 factoryPlugin 装配。
    const remindersEntry = byId.get("reminders");
    expect(remindersEntry, 'manifest 缺少 "reminders" 条目').toBeDefined();
    expect(remindersEntry).toMatchObject({ dependencies: [] });
    expect(remindersEntry?.core ?? false, '"reminders" 必须非 core（可开关）').toBe(false);
    expect(remindersEntry?.kind).toBeUndefined();
    expect(remindersEntry?.title, '"reminders" 缺 title').toMatch(/\S/);
  });

  it("reminders entry mounts the staged factory with the settings-threaded permission mode", async () => {
    // 仿 creation 装配形态的工厂调用探针：条目名 "reminders"，内嵌
    // factory:reminders 插件；应用到最小 ctx 后处理器落地（order 900），
    // 且 settings.permissionMode === "plan" 经 getter 透传——plan 档提醒
    // 注入，"auto" 装配面（无 settings）不注入。
    const ws = await tempWorkspace({});
    const settings = { ...DEFAULT_SETTINGS, permissionMode: "plan" as const };
    const plugins = await composition.composePlugins(ws, undefined, settings);
    const reminders = plugins.find((p) => p.name === "reminders");
    expect(reminders, '条目 "reminders" 未装配').toBeTruthy();
    expect(reminders && "plugin" in reminders && reminders.plugin?.name).toBe("factory:reminders");

    const processors: MessageProcessor[] = [];
    const factory = reminders && "plugin" in reminders ? reminders.plugin : undefined;
    await factory?.apply({ session: { registerProcessor: (p: MessageProcessor) => processors.push(p) } } as never);
    expect(processors).toHaveLength(1);
    expect(processors[0]).toMatchObject({ name: "reminders", order: 900 });

    const planned = { role: "user" as const, parts: [{ type: "text" as const, text: "go" }] };
    await processors[0].process(planned as never, {
      provider: { id: "probe" },
      signal: new AbortController().signal,
      scope: { sessionId: "s" },
    } as never);
    const plannedText = planned.parts.map((p) => (p as { text: string }).text).join("\n");
    expect(plannedText).toMatch(/planning permission/i);

    const unmanaged = await composition.composePlugins(ws);
    const unmanagedReminders = unmanaged.find((p) => p.name === "reminders");
    const unmanagedFactory = unmanagedReminders && "plugin" in unmanagedReminders ? unmanagedReminders.plugin : undefined;
    const unmanagedProcessors: MessageProcessor[] = [];
    await unmanagedFactory?.apply({ session: { registerProcessor: (p: MessageProcessor) => unmanagedProcessors.push(p) } } as never);
    const auto = { role: "user" as const, parts: [{ type: "text" as const, text: "go" }] };
    await unmanagedProcessors[0].process(auto as never, {
      provider: { id: "probe" },
      signal: new AbortController().signal,
      scope: { sessionId: "s" },
    } as never);
    expect(auto.parts.map((p) => (p as { text: string }).text).join("\n")).not.toMatch(/planning permission/i);
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
      "my-user-mode": { name: "my-user-mode", innocenceharness: { agentMode: { title: "My User Mode", description: "User mode hint" } } },
    });
    try {
      const modes = await composition.agentModes();
      const byId = new Map(modes.map((m) => [m.id, m]));
      // readManifest kind 透传端到端：内置模式插件经白名单重建仍带 kind，且
      // staging id 与注册的模式 id 一致（default/creation）——"creation" 没有
      // 兜底，清单改名漂移会让它从目录消失并被本断言拦截。
      expect(byId.get("creation")).toBeDefined();
      // 内置 default 现在来自 manifest 投影（title 为包描述），不是兜底值。
      expect(byId.get("default")).toMatchObject({ id: "default" });
      // 扫描并入：用户模式进目录，title/description 取 package.json 投影。
      expect(byId.get("my-user-mode")).toMatchObject({ id: "my-user-mode", title: "My User Mode", description: "User mode hint" });
    } finally {
      await composition.disposePluginBoot();
    }
  });

  // ---- D2：扫描描述符参与开关解析并入插件清单（修复轮 1）------------------

  it("scanned user plugin is visible in plugins:list and toggleable through settings toggles", async () => {
    const composition = scanComposition({
      "my-user-mode": { name: "my-user-mode", innocenceharness: { agentMode: { title: "My User Mode" } } },
    });
    try {
      const ws = await tempWorkspace({});
      // 默认：清单行可见且 active（title/toggleable 投影自扫描描述符）。
      const active = await composition.pluginInventory({ workspaceRoot: ws });
      expect(active.find((e) => e.id === "my-user-mode")).toMatchObject({
        title: "My User Mode",
        core: false,
        toggleable: true,
        state: "active",
        via: "default",
      });
      // 用户开关关闭：条目不装载 + 清单行呈 disabled-by-config/user。
      const off = (await composition.composePlugins(ws, { "my-user-mode": false })).map((p) => p.name);
      expect(off).not.toContain("my-user-mode");
      const inventory = await composition.pluginInventory({
        workspaceRoot: ws,
        userToggles: { "my-user-mode": false },
      });
      expect(inventory.find((e) => e.id === "my-user-mode")).toMatchObject({
        state: "disabled-by-config",
        via: "user",
      });
    } finally {
      await composition.disposePluginBoot();
    }
  });

  it("user cordis.yml toggle disables a scanned user plugin (user layer)", async () => {
    const home = mkdtempSync(path.join(tmpdir(), "ic-user-cordis-home-"));
    roots.push(home);
    mkdirSync(path.join(home, ".innocence"), { recursive: true });
    writeFileSync(path.join(home, ".innocence", "cordis.yml"), "plugins:\n  my-user-mode: false\n", "utf8");
    const composition = scanComposition({
      "my-user-mode": { name: "my-user-mode", innocenceharness: { agentMode: { title: "My User Mode" } } },
    });
    // os.homedir() on Windows follows USERPROFILE; keep the override scoped
    // （cordis.yml 的用户层读取走临时 home；扫描根仍是 scanComposition 的伪根）。
    const previousProfile = process.env.USERPROFILE;
    const previousHome = process.env.HOME;
    process.env.USERPROFILE = home;
    process.env.HOME = home;
    try {
      const ws = await tempWorkspace({});
      const names = (await composition.composePlugins(ws)).map((p) => p.name);
      expect(names).not.toContain("my-user-mode");
      expect(names).toContain("fs"); // 其余条目不受影响
      const inventory = await composition.pluginInventory({ workspaceRoot: ws });
      expect(inventory.find((e) => e.id === "my-user-mode")).toMatchObject({
        state: "disabled-by-config",
        via: "user",
      });
    } finally {
      if (previousProfile === undefined) delete process.env.USERPROFILE;
      else process.env.USERPROFILE = previousProfile;
      if (previousHome === undefined) delete process.env.HOME;
      else process.env.HOME = previousHome;
      await composition.disposePluginBoot();
    }
  });
});

// ---- 用户根 claude-code 布局适配（B5b 宿主适配器装载）--------------------
// 伪用户根放 claude-code 目录（.claude-plugin/plugin.json + commands/ +
// skills/）：composePlugins 产出的装配含适配器条目（plugin 字段携带宿主
// 插件对象，绕过 dist/index.js 双根 resolver——该布局无此文件），应用后经
// 真实会话链技能索引可见；disabled 描述符不装配。
maybeDescribe("composePlugins claude-code ecosystem adapter", () => {
  function claudeCodeComposition() {
    const userRoot = mkdtempSync(path.join(tmpdir(), "ic-cc-user-plugins-"));
    roots.push(userRoot);
    const pluginDir = path.join(userRoot, "cc-tool");
    mkdirSync(path.join(pluginDir, ".claude-plugin"), { recursive: true });
    writeFileSync(
      path.join(pluginDir, ".claude-plugin", "plugin.json"),
      JSON.stringify({ name: "cc-tool", description: "An external tool" }),
      "utf8",
    );
    mkdirSync(path.join(pluginDir, "skills", "greet"), { recursive: true });
    writeFileSync(
      path.join(pluginDir, "skills", "greet", "SKILL.md"),
      "---\nname: greet\ndescription: Greeting skill\n---\nGreet skill body.",
      "utf8",
    );
    mkdirSync(path.join(pluginDir, "commands"), { recursive: true });
    writeFileSync(
      path.join(pluginDir, "commands", "hello.md"),
      "---\nname: hello\ndescription: Say hello\n---\nHello command body.",
      "utf8",
    );
    const logged: string[] = [];
    const composition = createSessionComposition({
      resolvePaths: stagingBootPaths,
      getWorkspaceRoot: () => undefined,
      getUserPluginRoot: () => userRoot,
      enableHmrWatcher: false,
      log: (_level, msg) => logged.push(msg),
    });
    return { composition, logged };
  }

  it("composes an adapter-carried entry and the skills reach the live session", async () => {
    const { composition, logged } = claudeCodeComposition();
    try {
      const ws = await tempWorkspace({});
      const plugins = await composition.composePlugins(ws);
      const entry = plugins.find((p) => p.name === "cc-tool");
      // plugin 字段在场 = createResolved 直挂内核插件对象（builtinLoaderEntryFor
      // 同一机制）——不挂则装载走双根 resolver，claude-code 布局无 dist/index.js
      // 必失败；清单行同样并入（扫描描述符 active 投影）。
      expect(entry && "plugin" in entry && entry.plugin?.name).toBe("ecosystem:cc-tool");
      const inventory = await composition.pluginInventory({ workspaceRoot: ws });
      expect(inventory.find((e) => e.id === "cc-tool")).toMatchObject({ state: "active", toggleable: true });

      const boot = await composition.ensureBoot();
      const chats: unknown[] = [];
      const session = await AgentSession.create({
        scope: boot.createSessionScope(),
        spine: boot.spine,
        plugins,
        provider: createMockProvider({ turns: [{ text: "ok" }], onChat: (req) => chats.push(req) }),
        workspaceRoot: ws,
        permission: { mode: "auto", decider: { ask: async () => "deny" } },
        logger: (_level, message) => logged.push(message),
      });
      try {
        await session.run("/greet hi");
        // 技能经适配器注册进会话技能服务，"/name" 展开通道可见其正文。
        const seen = JSON.stringify(chats);
        expect(seen).toContain("已加载技能 greet");
        expect(seen).toContain("Greet skill body.");
        // 装载全程无 cc-tool 失败告警（resolver 失败路径未触发）。
        expect(logged.filter((line) => line.includes("cc-tool") && line.includes("failed")).join("\n")).toBe("");
      } finally {
        await session.dispose();
      }
    } finally {
      await composition.disposePluginBoot();
    }
  });

  it("disabled claude-code descriptor does not compose", async () => {
    const { composition } = claudeCodeComposition();
    try {
      const ws = await tempWorkspace({});
      const off = (await composition.composePlugins(ws, { "cc-tool": false })).map((p) => p.name);
      expect(off).not.toContain("cc-tool");
      expect(off).toContain("fs"); // 其余条目不受影响
    } finally {
      await composition.disposePluginBoot();
    }
  });
});

if (!stagingAvailable) {
  // A visible reason next to the skip (vitest shows it.skip without one).
  it.skip("staging tree not found — run `npm run build:plugins` then re-run to exercise the boot composition", () => {});
}
