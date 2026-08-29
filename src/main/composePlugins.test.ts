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

import { DEFAULT_SETTINGS, DEFAULT_ROUTE_ID, AgentSession } from "@innocenceharness/harness-electron";
import { createMockProvider } from "@innocenceharness/provider-mock";
import type { MessageProcessor } from "@innocenceharness/harness-session";
import type { ToolExecutionMiddleware } from "@innocenceharness/harness-tools";
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
// 与单模式插件 plan/focus/minimal/learning/auto/coordinator——learn 包注册
// id 是 "learning"，auto 为 B4D 自主模式插件，coordinator 为 B4E 协同
// 编排模式插件）。
// builtin-skills 为内置技能内容包：默认导出即插件对象（name 同 id），
// 向 skills 脊柱服务注册六个常驻技能。reminders 为消息侧提醒注入插件：
// 默认导出是工厂（同 creation 形态），由宿主 factoryPlugin 装配并传入
// settings 通道的许可档 getter（仿 creation 的映射与计数同步）。
// reference 为按需参考资料工具插件：默认导出即插件对象（name 同 id），
// 向 tools 服务注册只读 read_reference（四个内置参考条目的固定目录）。
// planflow 为计划提交流插件（批次 4A）：默认导出即插件对象（name 同
// id），静态插件形态——注册 plan_submit 工具 + 权限事件监听 + 批准/拒绝
// 提醒处理器，走通用装载链（无宿主工厂入参）。
// memory 为双根记忆存储插件（批次 4B）：默认导出是工厂（同 creation/
// reminders 形态），由宿主 factoryPlugin 装配并传入用户/项目记忆根 getter
// ——注册 memory_write/memory_list/memory_read 三工具。
// hooks 为声明式会话钩子插件（批次 4C）：默认导出是工厂（同 creation/
// reminders/memory 形态），由宿主 factoryPlugin 装配并传入合并后 hooks 声明
// getter（项目 yml 顶层 hooks: 覆盖用户 cordis.yml 同键）+ 会话工作区根
// getter——注册消息处理器（name "hooks"，order -450）与工具执行中间件
// （name "hooks"，pre 拦截/post 附注）两面。
// team 为具名队友协作插件（批次 4E）：默认导出是工厂（同 hooks 形态），
// 由宿主 factoryPlugin 装配并传入绑定路由会话身份的 sendToTeammate 端口
// ——注册 send_message 工具（对等权威信封投递 + 回复取回）。
// web 为网页抓取工具插件（批次 4F）：默认导出即插件对象（name 同 id），
// 静态形态走通用装载链——向 tools 服务注册只读 web_fetch（SSRF 基线：
// 内网/环回字面量拒绝 + 重定向每跳重验 + 文本类响应截断）。
const MANIFEST_IDS = [
  "fs", "shell", "subagent", "skills", "mcp", "ssh", "archive", "todo",
  "reference", "web", "builtin-skills", "reminders",
  "default", "creation", "plan", "focus", "minimal", "learning", "auto", "coordinator",
  "planflow",
  "memory",
  "hooks",
  "team",
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
      web: "web",
      "builtin-skills": "builtin-skills",
      reminders: "reminders",
      default: "default",
      creation: "creation",
      plan: "plan",
      focus: "focus",
      minimal: "minimal",
      learning: "learning",
      auto: "auto",
      coordinator: "coordinator",
      planflow: "planflow",
      memory: "memory",
      hooks: "hooks",
      team: "team",
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
    // plan/focus/minimal/learning/auto/coordinator）——切换器按清单 id 写
    // 设置、会话按注册 id 解析提示词，此处锁死两侧的一致性命名。
    for (const id of ["default", "creation", "plan", "focus", "minimal", "learning", "auto", "coordinator"]) {
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
    // 计划提交流插件（批次 4A）：静态能力插件（非 core、无依赖、无 kind），
    // 默认导出即插件对象——通用装载链直装载，name 与 staging id 同名。
    const planflowEntry = byId.get("planflow");
    expect(planflowEntry, 'manifest 缺少 "planflow" 条目').toBeDefined();
    expect(planflowEntry).toMatchObject({ dependencies: [] });
    expect(planflowEntry?.core ?? false, '"planflow" 必须非 core（可开关）').toBe(false);
    expect(planflowEntry?.kind).toBeUndefined();
    expect(planflowEntry?.title, '"planflow" 缺 title').toMatch(/\S/);
    // 双根记忆存储插件（批次 4B）：工厂型能力插件（非 core、无依赖、无
    // kind），由宿主 factoryPlugin 装配并传入两根 getter。
    const memoryEntry = byId.get("memory");
    expect(memoryEntry, 'manifest 缺少 "memory" 条目').toBeDefined();
    expect(memoryEntry).toMatchObject({ dependencies: [] });
    expect(memoryEntry?.core ?? false, '"memory" 必须非 core（可开关）').toBe(false);
    expect(memoryEntry?.kind).toBeUndefined();
    expect(memoryEntry?.title, '"memory" 缺 title').toMatch(/\S/);
    // 声明式会话钩子插件（批次 4C）：工厂型能力插件（非 core、无依赖、无
    // kind），由宿主 factoryPlugin 装配（顶层 hooks: 声明 + 工作区根经
    // getter 注入——插件不读宿主配置面）。
    const hooksEntry = byId.get("hooks");
    expect(hooksEntry, 'manifest 缺少 "hooks" 条目').toBeDefined();
    expect(hooksEntry).toMatchObject({ dependencies: [] });
    expect(hooksEntry?.core ?? false, '"hooks" 必须非 core（可开关）').toBe(false);
    expect(hooksEntry?.kind).toBeUndefined();
    expect(hooksEntry?.title, '"hooks" 缺 title').toMatch(/\S/);
    // 具名队友协作插件（批次 4E）：工厂型能力插件（非 core、无依赖、无
    // kind），由宿主 factoryPlugin 装配并传入身份绑定的投递端口。
    const teamEntry = byId.get("team");
    expect(teamEntry, 'manifest 缺少 "team" 条目').toBeDefined();
    expect(teamEntry).toMatchObject({ dependencies: [] });
    expect(teamEntry?.core ?? false, '"team" 必须非 core（可开关）').toBe(false);
    expect(teamEntry?.kind).toBeUndefined();
    expect(teamEntry?.title, '"team" 缺 title').toMatch(/\S/);
    // 网页抓取工具插件（批次 4F）：静态能力插件（非 core、无依赖、无
    // kind），默认导出即插件对象——通用装载链直装载，name 与 staging
    // id 同名。
    const webEntry = byId.get("web");
    expect(webEntry, 'manifest 缺少 "web" 条目').toBeDefined();
    expect(webEntry).toMatchObject({ dependencies: [] });
    expect(webEntry?.core ?? false, '"web" 必须非 core（可开关）').toBe(false);
    expect(webEntry?.kind).toBeUndefined();
    expect(webEntry?.title, '"web" 缺 title').toMatch(/\S/);
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

  it("reminders entry threads host usage and continuation getters per session identity", async () => {
    // 批次 4F 宿主接线探针：composition 带 getSessionUsage/isContinuationSession
    // 端口 + 会话身份组装 → staged reminders 工厂收到会话绑定 getter——
    // usage 越过首轮阈值注入一行；continuation 在 main 路由首轮注入一次；
    // 非 main 路由身份不注入 continuation（transcript 种子只在 main 路由）；
    // 无端口/无身份的组装面两个提醒保持未武装。
    const usage = { inputTokens: 90_000, outputTokens: 25_000, cachedInputTokens: 5_000, totalTokens: 115_000 };
    const wired = createSessionComposition({
      resolvePaths: stagingBootPaths,
      getWorkspaceRoot: () => undefined,
      getUserPluginRoot: () => path.join(tmpdir(), "ic-compose-no-user-plugins"),
      getSessionUsage: () => usage,
      isContinuationSession: () => true,
      log: () => {},
    });
    const ws = await tempWorkspace({});
    const mount = async (identity?: { sessionId: string; routeId: string }) => {
      const plugins = await wired.composePlugins(ws, undefined, undefined, identity);
      const reminders = plugins.find((p) => p.name === "reminders");
      const factory = reminders && "plugin" in reminders ? reminders.plugin : undefined;
      const processors: MessageProcessor[] = [];
      await factory?.apply({ session: { registerProcessor: (p: MessageProcessor) => processors.push(p) } } as never);
      return processors[0];
    };
    const textOf = (m: { parts: Array<{ type: string; text?: string }> }) =>
      m.parts.map((p) => (p as { text: string }).text).join("\n");

    const main = await mount({ sessionId: "sess-4f", routeId: DEFAULT_ROUTE_ID });
    const first = { role: "user" as const, parts: [{ type: "text" as const, text: "go" }] };
    await main.process(first as never, {
      provider: { id: "probe" },
      signal: new AbortController().signal,
      scope: { sessionId: "sess-4f" },
    } as never);
    const firstText = textOf(first);
    expect(firstText).toMatch(/token usage/i);
    expect(firstText).toContain("115000");
    expect(firstText).toMatch(/resumed|continued/i);

    const taskRoute = await mount({ sessionId: "sess-4f", routeId: "route-b" });
    const routeFirst = { role: "user" as const, parts: [{ type: "text" as const, text: "go" }] };
    await taskRoute.process(routeFirst as never, {
      provider: { id: "probe" },
      signal: new AbortController().signal,
      scope: { sessionId: "sess-4f" },
    } as never);
    const routeText = textOf(routeFirst);
    expect(routeText).toMatch(/token usage/i); // usage 按会话，任意路由可注入
    expect(routeText).not.toMatch(/resumed|continued/i); // continuation 仅 main 路由

    const unwired = await composition.composePlugins(ws);
    const unwiredReminders = unwired.find((p) => p.name === "reminders");
    const unwiredFactory = unwiredReminders && "plugin" in unwiredReminders ? unwiredReminders.plugin : undefined;
    const unwiredProcessors: MessageProcessor[] = [];
    await unwiredFactory?.apply({ session: { registerProcessor: (p: MessageProcessor) => unwiredProcessors.push(p) } } as never);
    const noPort = { role: "user" as const, parts: [{ type: "text" as const, text: "go" }] };
    await unwiredProcessors[0].process(noPort as never, {
      provider: { id: "probe" },
      signal: new AbortController().signal,
      scope: { sessionId: "sess-4f" },
    } as never);
    const noPortText = textOf(noPort);
    expect(noPortText).not.toMatch(/token usage/i); // 无端口：未武装
    expect(noPortText).not.toMatch(/resumed|continued/i);
  });

  it("memory entry mounts the staged factory with host-threaded roots", async () => {
    // 仿 reminders 装配形态的工厂调用探针：条目名 "memory"，内嵌
    // factory:memory 插件；应用到最小 ctx 后三工具与 memory-index 处理器
    // （order -500）落地，且默认 project 域写入落进 <ws>/.innocence/memory。
    // 用户根纯化：临时 home 覆盖 USERPROFILE/HOME（用户层 cordis.yml 用例
    // 的既有同源模式）——factory 的 getUserRoot 每次调用现读 os.homedir()，
    // 覆盖窗口含装配与执行全程，探针不读开发者真实 ~/.innocence。
    const home = mkdtempSync(path.join(tmpdir(), "ic-memory-probe-home-"));
    roots.push(home);
    const previousProfile = process.env.USERPROFILE;
    const previousHome = process.env.HOME;
    process.env.USERPROFILE = home;
    process.env.HOME = home;
    try {
      const ws = await tempWorkspace({});
      const plugins = await composition.composePlugins(ws);
      const memory = plugins.find((p) => p.name === "memory");
      expect(memory, '条目 "memory" 未装配').toBeTruthy();
      expect(memory && "plugin" in memory && memory.plugin?.name).toBe("factory:memory");

      const registered: Array<{ name: string; execute: (args: Record<string, unknown>, ctx: unknown) => Promise<{ content: string; isError?: boolean }> }> = [];
      const processors: MessageProcessor[] = [];
      const factory = memory && "plugin" in memory ? memory.plugin : undefined;
      await factory?.apply({
        tools: { register: (t: unknown) => registered.push(t as never) },
        session: { registerProcessor: (p: MessageProcessor) => processors.push(p) },
      } as never);
      expect(registered.map((t) => t.name)).toEqual(["memory_write", "memory_list", "memory_read"]);
      expect(processors).toHaveLength(1);
      expect(processors[0]).toMatchObject({ name: "memory-index", order: -500 });

      const ctxProbe = { workspaceRoot: ws, signal: new AbortController().signal, log: () => {}, scope: {} } as never;
      const write = registered.find((t) => t.name === "memory_write")!;
      const written = await write.execute({ id: "probe-note", content: "Factory probe body." }, ctxProbe);
      expect(written.isError).toBeFalsy();
      expect(existsSync(path.join(ws, ".innocence", "memory", "probe-note.md"))).toBe(true);
      const list = registered.find((t) => t.name === "memory_list")!;
      const listed = await list.execute({}, ctxProbe);
      expect(listed.content).toContain("probe-note [project]");
      // 纯化自证：tmp home 用户根为空，合并索引只见 project 行——真实
      // 用户根有条目时不再泄漏进探针输出。
      expect(listed.content).not.toMatch(/\[user\]/);
    } finally {
      if (previousProfile === undefined) delete process.env.USERPROFILE;
      else process.env.USERPROFILE = previousProfile;
      if (previousHome === undefined) delete process.env.HOME;
      else process.env.HOME = previousHome;
    }
  });

  it("hooks entry mounts the staged factory with both session and tool faces", async () => {
    // 仿 memory 装配形态的工厂调用探针（批次 4C）：条目名 "hooks"，内嵌
    // factory:hooks 插件；最小 ctx 必须同时供应 session.registerProcessor 与
    // tools.registerMiddleware（4B 教训：缺供应面即假绿），断言处理器形状
    // （name "hooks"、order -450——memory-index -500 之后）与中间件注册。
    // 配置流通断言不经进程面：项目 yml 顶层 hooks: 声明带未知事件名 →
    // 插件侧解析告警落首轮 session-start 块，证明 yml 值流入工厂。
    // 用户根纯化：cordis.yml 用户层读取走 os.homedir()，USERPROFILE/HOME
    // 覆盖为临时空 home（覆盖窗口含装配与执行全程）。
    const home = mkdtempSync(path.join(tmpdir(), "ic-hooks-probe-home-"));
    roots.push(home);
    const previousProfile = process.env.USERPROFILE;
    const previousHome = process.env.HOME;
    process.env.USERPROFILE = home;
    process.env.HOME = home;
    try {
      const ws = await tempWorkspace({
        ".innocence/plugins.yml": 'hooks:\n  - event: probe-bogus-event\n    command: probe-hook-cmd\n',
      });
      const plugins = await composition.composePlugins(ws);
      const hooks = plugins.find((p) => p.name === "hooks");
      expect(hooks, '条目 "hooks" 未装配').toBeTruthy();
      expect(hooks && "plugin" in hooks && hooks.plugin?.name).toBe("factory:hooks");

      const processors: MessageProcessor[] = [];
      const middlewares: ToolExecutionMiddleware[] = [];
      const factory = hooks && "plugin" in hooks ? hooks.plugin : undefined;
      await factory?.apply({
        session: { registerProcessor: (p: MessageProcessor) => processors.push(p) },
        tools: { registerMiddleware: (m: ToolExecutionMiddleware) => middlewares.push(m) },
      } as never);
      expect(processors).toHaveLength(1);
      expect(processors[0]).toMatchObject({ name: "hooks", order: -450 });
      expect(middlewares).toHaveLength(1);
      expect(middlewares[0]).toMatchObject({ name: "hooks" });
      expect(typeof middlewares[0].execute).toBe("function");

      const first = { role: "user" as const, parts: [{ type: "text" as const, text: "go" }] };
      await processors[0].process(first as never, { scope: { sessionId: "hooks-probe" } } as never);
      const firstText = first.parts.map((p) => (p as { text: string }).text).join("\n");
      expect(firstText).toContain("[hook warning]");
      expect(firstText).toContain('unknown event "probe-bogus-event"');

      // 无声明 → 空钩子集：插件照常挂载，三面无操作（首轮无任何 hook 块）。
      const bare = await tempWorkspace({});
      const barePlugins = await composition.composePlugins(bare);
      const bareHooks = barePlugins.find((p) => p.name === "hooks");
      expect(bareHooks, '无配置时条目 "hooks" 仍装配').toBeTruthy();
      const bareProcessors: MessageProcessor[] = [];
      const bareFactory = bareHooks && "plugin" in bareHooks ? bareHooks.plugin : undefined;
      await bareFactory?.apply({
        session: { registerProcessor: (p: MessageProcessor) => bareProcessors.push(p) },
        tools: { registerMiddleware: () => {} },
      } as never);
      const quiet = { role: "user" as const, parts: [{ type: "text" as const, text: "go" }] };
      await bareProcessors[0].process(quiet as never, { scope: { sessionId: "hooks-quiet" } } as never);
      expect(quiet.parts.map((p) => (p as { text: string }).text).join("\n")).not.toContain("[hook");
    } finally {
      if (previousProfile === undefined) delete process.env.USERPROFILE;
      else process.env.USERPROFILE = previousProfile;
      if (previousHome === undefined) delete process.env.HOME;
      else process.env.HOME = previousHome;
    }
  });

  it("hooks declarations resolve project over user through the composition", async () => {
    // 同键合并策略端到端：项目层顶层 hooks: 覆盖用户层（原子覆盖，不并
    // 数组）；项目缺席时回落用户层。用户层经 cordis.yml（os.homedir() 读
    // 取——同上纯化，覆盖窗口含两次装配与执行）。
    const home = mkdtempSync(path.join(tmpdir(), "ic-hooks-merge-home-"));
    roots.push(home);
    mkdirSync(path.join(home, ".innocence"), { recursive: true });
    writeFileSync(
      path.join(home, ".innocence", "cordis.yml"),
      'hooks:\n  - event: user-bogus-event\n    command: user-hook\n',
      "utf8",
    );
    const previousProfile = process.env.USERPROFILE;
    const previousHome = process.env.HOME;
    process.env.USERPROFILE = home;
    process.env.HOME = home;
    try {
      const runFirstTurn = async (ws: string): Promise<string> => {
        const plugins = await composition.composePlugins(ws);
        const hooks = plugins.find((p) => p.name === "hooks");
        const factory = hooks && "plugin" in hooks ? hooks.plugin : undefined;
        const processors: MessageProcessor[] = [];
        await factory?.apply({
          session: { registerProcessor: (p: MessageProcessor) => processors.push(p) },
          tools: { registerMiddleware: () => {} },
        } as never);
        const message = { role: "user" as const, parts: [{ type: "text" as const, text: "go" }] };
        await processors[0].process(message as never, { scope: { sessionId: "hooks-merge" } } as never);
        return message.parts.map((p) => (p as { text: string }).text).join("\n");
      };
      // 项目无 hooks 声明 → 用户层回落（user-bogus-event 到达工厂）。
      const fallback = await runFirstTurn(await tempWorkspace({}));
      expect(fallback).toContain('unknown event "user-bogus-event"');
      // 项目声明同键 → 项目覆盖用户（只见表象 project 事件，不见 user 事件）。
      const overridden = await runFirstTurn(await tempWorkspace({
        ".innocence/plugins.yml": 'hooks:\n  - event: project-bogus-event\n    command: project-hook\n',
      }));
      expect(overridden).toContain('unknown event "project-bogus-event"');
      expect(overridden).not.toContain("user-bogus-event");
    } finally {
      if (previousProfile === undefined) delete process.env.USERPROFILE;
      else process.env.USERPROFILE = previousProfile;
      if (previousHome === undefined) delete process.env.HOME;
      else process.env.HOME = previousHome;
    }
  });

  it("hooks stop face skips execution when the host shutdown gate is flipped", async () => {
    // 宿主关机旗标穿线探针（批次 5 修复 1）：composition 带 isHostShuttingDown
    // 端口（伪 gate——布尔翻转，仿 index.ts ShutdownGate 的查询面）→ staged
    // hooks 工厂收到 getter，apply 返回的 stop 面在关机态整面跳过：sessionStop
    // 命令零执行（marker 文件不出现、日志无任何 stop command 行），只落 bypass
    // 行；对照面（旗标未翻）同一装配照常执行命令并写 marker——证明跳过源自
    // 关机旗标而非缺许可（ctx 恒供 allow 的 permissions 面）。marker 路径经
    // env 传入（命令 tokenizer 无引号支持，路径不得进命令串）；用户层
    // cordis.yml 读取纯化同上（临时空 home，覆盖窗口含装配与执行全程）。
    let shuttingDown = false;
    const gated = createSessionComposition({
      resolvePaths: stagingBootPaths,
      getWorkspaceRoot: () => undefined,
      getUserPluginRoot: () => path.join(tmpdir(), "ic-compose-no-user-plugins"),
      isHostShuttingDown: () => shuttingDown,
      log: () => {},
    });
    const home = mkdtempSync(path.join(tmpdir(), "ic-hooks-shutdown-home-"));
    roots.push(home);
    const previousProfile = process.env.USERPROFILE;
    const previousHome = process.env.HOME;
    const previousMarkerEnv = process.env.IC_STOP_PROBE_MARKER;
    process.env.USERPROFILE = home;
    process.env.HOME = home;
    try {
      // marker 写入命令：-e 负载 whitespace-free，文件路径经 env 读取；yml
      // 单引号风格（反斜杠字面量，负载内单引号加倍转义）。
      const payload = "require('fs').writeFileSync(process.env.IC_STOP_PROBE_MARKER,'x')";
      const ymlCommand = `'${process.execPath} -e ${payload.replaceAll("'", "''")}'`;
      const mount = async (): Promise<{ dispose: () => Promise<void>; lines: string[]; ws: string }> => {
        const ws = await tempWorkspace({
          ".innocence/plugins.yml": `hooks:\n  - event: sessionStop\n    command: ${ymlCommand}\n`,
        });
        const plugins = await gated.composePlugins(ws);
        const hooks = plugins.find((p) => p.name === "hooks");
        const factory = hooks && "plugin" in hooks ? hooks.plugin : undefined;
        const lines: string[] = [];
        const dispose = (await factory?.apply({
          session: { registerProcessor: () => {} },
          tools: { registerMiddleware: () => {} },
          permissions: {
            engine: {
              async resolve() {
                return { decision: "allow", via: "ask", reason: "fixture" };
              },
            },
          },
          logger: { log: (_level: unknown, message: string) => lines.push(message) },
        } as never)) as () => Promise<void>;
        expect(typeof dispose).toBe("function");
        return { dispose, lines, ws };
      };

      // 对照面：旗标未翻，stop 命令照常执行（marker 落盘 + 完成日志行）。
      const control = await mount();
      const controlMarker = path.join(control.ws, "stop-ran.marker");
      process.env.IC_STOP_PROBE_MARKER = controlMarker;
      await control.dispose();
      expect(existsSync(controlMarker)).toBe(true);
      expect(control.lines.some((line) => line.includes('stop command "'))).toBe(true);

      // 探针面：伪 gate 翻转（宿主进入关机态）→ stop 面整面跳过，零执行。
      const probe = await mount();
      const probeMarker = path.join(probe.ws, "stop-ran.marker");
      process.env.IC_STOP_PROBE_MARKER = probeMarker;
      shuttingDown = true;
      await probe.dispose();
      expect(existsSync(probeMarker)).toBe(false);
      expect(probe.lines.some((line) => line.includes("bypassed because the host is shutting down"))).toBe(
        true,
      );
      expect(probe.lines.some((line) => line.includes('stop command "'))).toBe(false);
    } finally {
      if (previousProfile === undefined) delete process.env.USERPROFILE;
      else process.env.USERPROFILE = previousProfile;
      if (previousHome === undefined) delete process.env.HOME;
      else process.env.HOME = previousHome;
      if (previousMarkerEnv === undefined) delete process.env.IC_STOP_PROBE_MARKER;
      else process.env.IC_STOP_PROBE_MARKER = previousMarkerEnv;
    }
  });

  it("team entry mounts the staged factory with the identity-bound teammate port", async () => {
    // 仿 hooks 装配形态的工厂调用探针（批次 4E）：条目名 "team"，内嵌
    // factory:team 插件；应用到最小 ctx（tools.register——4B 教训：供应
    // 插件需要的全部面）后 send_message 落地，且宿主 createTeammatePort
    // 收到 composePlugins 的会话身份、工具执行经端口往返（ok/!ok 两态）。
    const delivered: Array<{ teammate: string; message: string }> = [];
    const identities: unknown[] = [];
    const probe = createSessionComposition({
      resolvePaths: stagingBootPaths,
      getWorkspaceRoot: () => undefined,
      getUserPluginRoot: () => path.join(tmpdir(), "ic-compose-no-user-plugins"),
      enableHmrWatcher: false,
      createTeammatePort: (identity) => {
        identities.push(identity);
        return async (teammate, message) => {
          delivered.push({ teammate, message });
          return teammate === "ghost"
            ? { ok: false, error: 'Unknown teammate "ghost"; available teammates: worker-1.' }
            : { ok: true, reply: `ack from ${teammate}` };
        };
      },
      log: () => {},
    });
    try {
      const ws = await tempWorkspace({});
      const identity = { sessionId: "chat-9", routeId: "main", taskId: "task-9" };
      const plugins = await probe.composePlugins(ws, undefined, undefined, identity);
      const team = plugins.find((p) => p.name === "team");
      expect(team, '条目 "team" 未装配').toBeTruthy();
      expect(team && "plugin" in team && team.plugin?.name).toBe("factory:team");

      const registered: Array<{ name: string; execute: (args: Record<string, unknown>, ctx: unknown) => Promise<{ content: string; isError?: boolean }> }> = [];
      const factory = team && "plugin" in team ? team.plugin : undefined;
      await factory?.apply({
        tools: { register: (t: unknown) => registered.push(t as never) },
      } as never);
      expect(registered.map((t) => t.name)).toEqual(["send_message"]);

      const ctxProbe = { signal: new AbortController().signal } as never;
      const acked = await registered[0].execute({ teammate: "worker-1", message: "probe ping" }, ctxProbe);
      expect(acked.isError).toBeFalsy();
      expect(acked.content).toBe("ack from worker-1");
      expect(delivered).toEqual([{ teammate: "worker-1", message: "probe ping" }]);
      // 身份只经宿主钩子流入工厂（组合层不吞不换）。
      expect(identities).toEqual([identity]);
      const failed = await registered[0].execute({ teammate: "ghost", message: "anyone there" }, ctxProbe);
      expect(failed.isError).toBe(true);
      expect(failed.content).toContain("Unknown teammate");
    } finally {
      await probe.disposePluginBoot();
    }
  });

  it("team entry without the host port still mounts and answers the no-teammates error", async () => {
    // 无 createTeammatePort 钩子的组装面（本文件级组合根即无）：插件照常
    // 挂载，send_message 恒答 no-teammates 错误（无路由系统的既定语义）。
    const ws = await tempWorkspace({});
    const plugins = await composePlugins(ws);
    const team = plugins.find((p) => p.name === "team");
    expect(team, '无端口钩子时条目 "team" 仍装配').toBeTruthy();
    expect(team && "plugin" in team && team.plugin?.name).toBe("factory:team");
    const registered: Array<{ name: string; execute: (args: Record<string, unknown>, ctx: unknown) => Promise<{ content: string; isError?: boolean }> }> = [];
    const factory = team && "plugin" in team ? team.plugin : undefined;
    await factory?.apply({
      tools: { register: (t: unknown) => registered.push(t as never) },
    } as never);
    const result = await registered[0].execute({ teammate: "anyone", message: "hi" }, { signal: new AbortController().signal } as never);
    expect(result.isError).toBe(true);
    expect(result.content).toMatch(/no named teammates/i);
  });

  it("web entry mounts the staged plugin with the guarded web_fetch tool", async () => {
    // 静态装载探针（批次 4F）：条目名 "web"（无 plugin 字段——通用装载
    // 链经双根 resolver 装 staging dist）；staged 默认导出应用到最小 ctx
    // （4B 教训：供应插件需要的 tools.register 面）后 web_fetch 落地。
    // 断言全离线：只读 + network 副作用类 + 域名 scope 权限资源 + 内网
    // 字面量拒绝——探针不发任何真实网络请求。
    const ws = await tempWorkspace({});
    const web = (await composePlugins(ws)).find((p) => p.name === "web");
    expect(web, '条目 "web" 未装配').toBeTruthy();
    expect(web && ("plugin" in web ? web.plugin : undefined)).toBeUndefined(); // resolver 路径（非工厂携带）

    const boot = await composition.ensureBoot();
    const plugin = (await boot.importPlugin("web")) as {
      name: string;
      apply(ctx: unknown): void | Promise<void>;
    };
    expect(plugin.name).toBe("web");
    const registered: Array<{
      name: string;
      readOnly: boolean;
      sideEffect?: string;
      validateArgs?: (args: Record<string, unknown>) => void;
      permissionResource: (args: Record<string, unknown>, ctx: unknown) => { action: string; kind: string; scope: string };
      persistArgs: (args: Record<string, unknown>) => Record<string, unknown>;
    }> = [];
    await plugin.apply({ tools: { register: (t: unknown) => registered.push(t as never) } });
    expect(registered.map((t) => t.name)).toEqual(["web_fetch"]);

    const tool = registered[0];
    expect(tool.readOnly).toBe(true);
    expect(tool.sideEffect).toBe("network");
    expect(tool.validateArgs!({ url: "https://example.com/page" })).toBeUndefined();
    expect(() => tool.validateArgs!({ url: "http://127.0.0.1/admin" })).toThrow(/目标地址不允许/);
    const ctxProbe = { signal: new AbortController().signal } as never;
    expect(tool.permissionResource({ url: "https://Example.COM/a" }, ctxProbe)).toEqual({
      action: "read",
      kind: "web",
      scope: "example.com",
    });
    expect(tool.persistArgs({ url: "https://example.com/a" })).toEqual({ url: "https://example.com/a" });
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

// ---- 用户根外部生态布局适配（B5b 宿主适配器装载）--------------------------
// 伪用户根放外部生态布局目录（.claude-plugin/plugin.json + commands/ +
// skills/，探测目标为互操作数据）：composePlugins 产出的装配含适配器条目
// （plugin 字段携带宿主插件对象，绕过 dist/index.js 双根 resolver——该布
// 局无此文件），应用后经真实会话链技能索引可见；disabled 描述符不装配。
maybeDescribe("composePlugins external ecosystem adapter", () => {
  function ecosystemComposition() {
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
    const { composition, logged } = ecosystemComposition();
    try {
      const ws = await tempWorkspace({});
      const plugins = await composition.composePlugins(ws);
      const entry = plugins.find((p) => p.name === "cc-tool");
      // plugin 字段在场 = createResolved 直挂内核插件对象（builtinLoaderEntryFor
      // 同一机制）——不挂则装载走双根 resolver，外部生态布局无 dist/index.js
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

  it("disabled ecosystem descriptor does not compose", async () => {
    const { composition } = ecosystemComposition();
    try {
      const ws = await tempWorkspace({});
      const off = (await composition.composePlugins(ws, { "cc-tool": false })).map((p) => p.name);
      expect(off).not.toContain("cc-tool");
      expect(off).toContain("fs"); // 其余条目不受影响
    } finally {
      await composition.disposePluginBoot();
    }
  });

  it("manifest id collision keeps the builtin load path and attaches no adapter", async () => {
    // 用户根放与清单同 id（skills 工厂 / fs core）的外部生态布局目录：
    // resolveBuiltinSet 并入时清单优先（mergeExtraDescriptors），冲突的扫描
    // 描述符被丢弃——适配器同样不得挂载，否则第三方目录顶替清单条目的
    // 工厂/core 装载（skills 静默无技能、fs core 失败中止会话构建）。
    const userRoot = mkdtempSync(path.join(tmpdir(), "ic-ecosystem-collision-"));
    roots.push(userRoot);
    for (const id of ["skills", "fs"]) {
      const pluginDir = path.join(userRoot, id);
      mkdirSync(path.join(pluginDir, ".claude-plugin"), { recursive: true });
      writeFileSync(
        path.join(pluginDir, ".claude-plugin", "plugin.json"),
        JSON.stringify({ name: id }),
        "utf8",
      );
      mkdirSync(path.join(pluginDir, "commands"), { recursive: true });
      writeFileSync(
        path.join(pluginDir, "commands", "shadow.md"),
        "---\nname: shadow\ndescription: shadow\n---\nshadow body.",
        "utf8",
      );
    }
    const composition = createSessionComposition({
      resolvePaths: stagingBootPaths,
      getWorkspaceRoot: () => undefined,
      getUserPluginRoot: () => userRoot,
      enableHmrWatcher: false,
      log: () => {},
    });
    try {
      const ws = await tempWorkspace({});
      const plugins = await composition.composePlugins(ws);
      // 清单条目胜出：skills 仍是宿主工厂装配，fs 仍走 resolver（无 plugin）。
      const skills = plugins.find((p) => p.name === "skills");
      expect(skills && "plugin" in skills && skills.plugin?.name).toBe("factory:skills");
      const coreFs = plugins.find((p) => p.name === "fs");
      expect(coreFs && ("plugin" in coreFs ? coreFs.plugin : undefined)).toBeUndefined();
      // 全装配无任何适配器条目（冲突目录两处均不得复活为 ecosystem:*）。
      expect(plugins.some((p) => "plugin" in p && p.plugin?.name?.startsWith("ecosystem:"))).toBe(false);
    } finally {
      await composition.disposePluginBoot();
    }
  });
});

if (!stagingAvailable) {
  // A visible reason next to the skip (vitest shows it.skip without one).
  it.skip("staging tree not found — run `npm run build:plugins` then re-run to exercise the boot composition", () => {});
}
