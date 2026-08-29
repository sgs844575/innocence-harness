// 预构建参与分发的包并组装 staging 树：
//   build/dist/resources/node_modules/@innocenceharness/<name>/{dist/,package.json}
//   build/dist/resources/plugins/<id>/{dist/,package.json}
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const LIBS = [
  "vendor/kernel",
  "vendor/kernel-loader",
  "vendor/kernel-include",
  "vendor/kernel-group",
  "vendor/kernel-logger",
  "vendor/kernel-timer",
  "vendor/kernel-hmr",
  // 脊柱八包：能力插件 dist 的跨包裸导入（如 mcp→harness-tools、
  // provider-*→harness-providers、agent-loop→session/tools/permissions/agent）
  // 经 staging node_modules 解析。
  "packages/harness-tools",
  "packages/harness-permissions",
  "packages/harness-providers",
  "packages/harness-ai-runtime",
  "packages/harness-skills",
  "packages/harness-session",
  "packages/harness-system-prompt",
  "packages/harness-agent",
  "packages/harness-agent-loop",
  // 改编子代理预设库：plugin-subagent dist 对它的运行时导入经 staging
  // node_modules 解析（同为 LIBS 条目，产物先落 @innocenceharness/agent-presets）。
  "packages/agent-presets",
];
// 内置清单（boot 侧 toggle 解析的描述符来源）：id + core 标记 + 依赖关系，
// 随 staging 产出 manifest.json；可开关标记（toggleable）由 core 派生
// （core 恒不可关）。可开关的能力插件——provider/task 等由宿主组合层按需
// 装配，不进 toggle 面；example 为渲染层示例插件（client-only：无会话
// 实例化分支，client 标记驱动 webview 侧装载链；manifest 内即 toggleable）。
// default/creation 为 agent 模式插件（kind "agent-mode" 能力类别标记，模式
// 目录投影用）：default 直装载默认导出，creation 默认导出是工厂，由宿主
// factoryPlugin 装配（见 pluginBoot/sessionComposition）。plan/focus/
// minimal/learning 为四个单模式插件（B1 模式预设库），auto 为自主模式
// 插件（B4D 自动化循环批次，同构），coordinator 为协同编排模式插件
// （B4E 多代理协作批次，同构）：直装载默认导出，各注册一个同名
// 模式 + 一个模式标签人设片段。staging id 必须与
// 插件内 AgentsService 注册的模式 id 一致——切换器按清单 id 展示并写入设置，
// 会话侧按注册 id 解析提示词，两侧不一致会导致选中后静默回落基础提示词
// （learn 包目录名与模式 id 不同，清单 id 锁死 "learning"）。
// builtin-skills 为内置技能内容包（B2 技能批次）：直装载默认导出，向
// skills 脊柱服务注册六个常驻技能；清单序位于 "skills" 之后——磁盘技能
// 先注册，同名冲突时用户/项目层技能胜出（与 resolver 用户根影子覆盖同义）。
// reminders 为消息侧提醒注入插件（B3 提醒批次）：默认导出是工厂（同
// creation 形态），由宿主 factoryPlugin 装配并传入许可档 getter——经
// MessageProcessor 每轮追加 <system-reminder> text part，不触碰系统提示词。
// reference 为按需参考资料工具插件（B4 参考资料批次）：默认导出即插件
// 对象（name 同 id），向 tools 服务注册只读工具 read_reference——四个
// 英文参考条目的目录固定，参考资料不常驻提示词，模型按需逐条拉取
// （缓存纪律：稳定前缀不被参考内容扰动）。
// planflow 为计划提交流插件（B4A 规划工具链）：默认导出即插件对象
// （name 同 id），静态形态走通用装载链——注册 plan_submit 工具、监听
// 权限决议事件（ask 级 allow 即计划批准）、在消息侧注入批准/拒绝提醒。
// memory 为双根记忆存储插件（B4B 记忆批次）：默认导出是工厂（同
// creation/reminders 形态），由宿主 factoryPlugin 装配并传入用户/项目两
// 个记忆根 getter——注册写列读三工具，条目落 <root>/memory/<id>.md，
// 用户根在前影子覆盖项目根同 id 条目。
// hooks 为声明式会话钩子插件（B4C 钩子批次）：默认导出是工厂（同
// creation/reminders/memory 形态），由宿主 factoryPlugin 装配并传入合并后
// 顶层 hooks 声明（项目 plugins.yml 覆盖用户 cordis.yml 同键）+ 会话工作
// 区根两个 getter——注册消息处理器（order -450，会话启动/用户输入两面）
// 与工具执行中间件（pre 拦截/post 附注），命令执行无 shell、限时限量。
// team 为具名队友协作插件（B4E 协作批次）：默认导出是工厂（同
// creation/reminders/memory/hooks 形态），由宿主 factoryPlugin 装配并传入
// 绑定当次路由会话身份的 sendToTeammate 投递端口——注册 send_message
// 工具（向具名队友路由投递携带对等权威信封的回合并取回回复；持久化仅
// 队友名与消息摘要），无任务路由的组装面恒答"无具名队友"。
const BUILTIN_DESCRIPTORS = [
  { id: "fs", core: true, dependencies: [] },
  { id: "shell", core: true, dependencies: [] },
  { id: "subagent", dependencies: ["fs", "shell"] },
  { id: "skills", dependencies: ["fs"] },
  { id: "mcp", dependencies: [] },
  { id: "ssh", dependencies: [] },
  { id: "archive", dependencies: ["fs"] },
  { id: "todo", dependencies: [] },
  { id: "reference", dependencies: [] },
  { id: "builtin-skills", dependencies: [] },
  { id: "reminders", dependencies: [] },
  { id: "default", kind: "agent-mode", dependencies: [] },
  { id: "creation", kind: "agent-mode", dependencies: [] },
  { id: "plan", kind: "agent-mode", dependencies: [] },
  { id: "focus", kind: "agent-mode", dependencies: [] },
  { id: "minimal", kind: "agent-mode", dependencies: [] },
  { id: "learning", kind: "agent-mode", dependencies: [] },
  { id: "auto", kind: "agent-mode", dependencies: [] },
  { id: "coordinator", kind: "agent-mode", dependencies: [] },
  { id: "planflow", dependencies: [] },
  { id: "memory", dependencies: [] },
  { id: "hooks", dependencies: [] },
  { id: "team", dependencies: [] },
  { id: "example", dependencies: [] },
];
const PLUGINS = [
  { dir: "packages/plugin-example", id: "example" },
  { dir: "packages/tools-fs", id: "fs" },
  { dir: "packages/tools-shell", id: "shell" },
  { dir: "packages/tools-todo", id: "todo" },
  { dir: "packages/tools-reference", id: "reference" },
  { dir: "packages/plugin-skills", id: "skills" },
  { dir: "packages/plugin-mcp", id: "mcp" },
  { dir: "packages/tools-ssh", id: "ssh" },
  { dir: "packages/tools-archive", id: "archive" },
  { dir: "packages/plugin-subagent", id: "subagent" },
  { dir: "packages/plugin-task", id: "task" },
  { dir: "packages/plugin-builtin-skills", id: "builtin-skills" },
  { dir: "packages/plugin-reminders", id: "reminders" },
  { dir: "packages/provider-anthropic", id: "provider-anthropic" },
  { dir: "packages/provider-google", id: "provider-google" },
  { dir: "packages/provider-openai", id: "provider-openai" },
  { dir: "packages/provider-mock", id: "provider-mock" },
  { dir: "packages/plugin-agent-default", id: "default" },
  { dir: "packages/plugin-agent-creation", id: "creation" },
  { dir: "packages/plugin-agent-plan", id: "plan" },
  { dir: "packages/plugin-agent-focus", id: "focus" },
  { dir: "packages/plugin-agent-minimal", id: "minimal" },
  { dir: "packages/plugin-agent-learn", id: "learning" },
  { dir: "packages/plugin-agent-auto", id: "auto" },
  { dir: "packages/plugin-agent-coordinator", id: "coordinator" },
  { dir: "packages/plugin-planflow", id: "planflow" },
  { dir: "packages/plugin-memory", id: "memory" },
  { dir: "packages/plugin-hooks", id: "hooks" },
  { dir: "packages/plugin-team", id: "team" },
];
const STAGING = "build/dist/resources";
const WORKSPACE_SCOPE = "@innocenceharness";
const EXTERNAL_RUNTIME_PACKAGES = [
  "ai",
  "zod",
  "@ai-sdk/openai",
  "@ai-sdk/anthropic",
  "@ai-sdk/google",
  // 插件 dist 的运行时裸导入：plugin-skills→yaml、harness-ai-runtime→undici、
  // tools-ssh→ssh2、plugin-mcp→ws，与根 package.json 声明保持一致。
  "yaml",
  "undici",
  "ssh2",
  "ws",
];

// 运行时 manifest：源 manifest 的 main/exports 指向 src（开发态源码直引），
// staging 副本改指 dist 产物。
function runtimeManifest(pkgDir) {
  const pkg = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8"));
  return {
    name: pkg.name,
    version: pkg.version,
    description: pkg.description,
    type: pkg.type,
    main: "./dist/index.js",
    exports: { ".": "./dist/index.js", "./package.json": "./package.json" },
  };
}

function assertWorkspacePackageMetadata(file, expectedName) {
  const raw = readFileSync(file, "utf8");
  const pkg = JSON.parse(raw);
  const retiredScope = `${WORKSPACE_SCOPE.slice(0, -7)}code`;
  if (pkg.name !== expectedName || !pkg.name.startsWith(`${WORKSPACE_SCOPE}/`)) {
    console.error(`staging self-check failed: package metadata scope mismatch in ${file}`);
    process.exit(1);
  }
  for (const section of ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"]) {
    const dependencies = pkg[section];
    if (!dependencies || typeof dependencies !== "object") continue;
    const invalidDependency = Object.keys(dependencies).find((name) =>
      name.startsWith("@innocence") && !name.startsWith(`${WORKSPACE_SCOPE}/`));
    if (invalidDependency) {
      console.error(`staging self-check failed: dependency scope mismatch in ${file}: ${invalidDependency}`);
      process.exit(1);
    }
  }
  if (raw.includes(`${retiredScope}/`)) {
    console.error(`staging self-check failed: retired package scope in ${file}`);
    process.exit(1);
  }
}

// tsc 不会重写导入说明符：源码按 bundler 解析写无后缀相对导入（"./context"），
// 而 Node ESM 要求相对说明符带显式扩展名。emit 后就地补 .js，staging 产物才能
// 被 Node（以及打包应用内的动态 import）直接加载。已带扩展名的说明符不动。
function fixEsmSpecifiers(file) {
  let code = readFileSync(file, "utf8");
  code = code.replace(
    /(from\s*|import\s*\(\s*)(["'])(\.\.?\/[^"']*)\2/g,
    (match, keyword, quote, specifier) =>
      /\.(js|mjs|cjs|json)$/.test(specifier) ? match : `${keyword}${quote}${specifier}.js${quote}`,
  );
  writeFileSync(file, code, "utf8");
}

function fixDist(pkgDir) {
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const file = join(dir, name);
      if (statSync(file).isDirectory()) { walk(file); continue; }
      if (name.endsWith(".js")) fixEsmSpecifiers(file);
    }
  };
  walk(join(pkgDir, "dist"));
}

function build(pkgDir) {
  rmSync(join(pkgDir, "dist"), { recursive: true, force: true });
  // Windows 上 npx 是 .cmd，spawnSync 必须经 shell 才能找到（参数为固定字面量）。
  const tsc = spawnSync("npx", ["tsc", "-p", join(pkgDir, "tsconfig.build.json")], { stdio: "inherit", shell: true });
  if (tsc.status !== 0) { console.error(`build failed: ${pkgDir}`); process.exit(1); }
  fixDist(pkgDir);
}

function copyRuntimeDependency(name, copied = new Set()) {
  if (copied.has(name) || name.startsWith(`${WORKSPACE_SCOPE}/`)) return;
  copied.add(name);
  const source = join("node_modules", ...name.split("/"));
  if (!existsSync(source)) {
    console.error(`staging dependency missing from node_modules: ${name}`);
    process.exit(1);
  }
  const target = join(STAGING, "node_modules", ...name.split("/"));
  cpSync(source, target, { recursive: true });
  const manifest = JSON.parse(readFileSync(join(source, "package.json"), "utf8"));
  const dependencies = {
    ...(manifest.dependencies ?? {}),
    ...(manifest.optionalDependencies ?? {}),
  };
  for (const dependency of Object.keys(dependencies)) copyRuntimeDependency(dependency, copied);
}

rmSync("build/dist", { recursive: true, force: true });
const copiedRuntimeDependencies = new Set();
for (const dependency of EXTERNAL_RUNTIME_PACKAGES) {
  copyRuntimeDependency(dependency, copiedRuntimeDependencies);
}
for (const dir of LIBS) {
  build(dir);
  const pkg = runtimeManifest(dir);
  assertWorkspacePackageMetadata(join(dir, "package.json"), pkg.name);
  const name = pkg.name.replace(new RegExp(`^${WORKSPACE_SCOPE.replace("@", "\\@")}\\/`), "");
  const target = join(STAGING, "node_modules", WORKSPACE_SCOPE, name);
  mkdirSync(target, { recursive: true });
  cpSync(join(dir, "dist"), join(target, "dist"), { recursive: true });
  writeFileSync(join(target, "package.json"), JSON.stringify(pkg, null, 2) + "\n", "utf8");
}
for (const { dir, id } of PLUGINS) {
  build(dir);
  const pkg = runtimeManifest(dir);
  assertWorkspacePackageMetadata(join(dir, "package.json"), pkg.name);
  const target = join(STAGING, "plugins", id);
  mkdirSync(target, { recursive: true });
  cpSync(join(dir, "dist"), join(target, "dist"), { recursive: true });
  writeFileSync(join(target, "package.json"), JSON.stringify(pkg, null, 2) + "\n", "utf8");
}

// 内置清单：boot 读取的插件 id 列表 + core 标记 + 依赖 + 中性展示名（包
// description 投影为 title）+ client 标记（构建后 dist/client.js 是否存在）。
const builtinIds = new Set(PLUGINS.map(({ id }) => id));
for (const descriptor of BUILTIN_DESCRIPTORS) {
  if (!builtinIds.has(descriptor.id)) {
    console.error(`builtin descriptor "${descriptor.id}" has no staged plugin`);
    process.exit(1);
  }
}
const manifestPlugins = BUILTIN_DESCRIPTORS.map((descriptor) => {
  const stagedPkg = JSON.parse(readFileSync(join(STAGING, "plugins", descriptor.id, "package.json"), "utf8"));
  return {
    ...descriptor,
    title: typeof stagedPkg.description === "string" && stagedPkg.description !== ""
      ? stagedPkg.description
      : descriptor.id,
    client: existsSync(join(STAGING, "plugins", descriptor.id, "dist", "client.js")),
    toggleable: descriptor.core !== true,
  };
});
writeFileSync(
  join(STAGING, "plugins", "manifest.json"),
  JSON.stringify({ plugins: manifestPlugins }, null, 2) + "\n",
  "utf8",
);

// 自检：staging 内 kernel 库与各清单插件的入口产物必须真实存在。
const selfCheck = [join(STAGING, "node_modules", WORKSPACE_SCOPE, "kernel", "dist", "index.js")];
for (const dir of LIBS) {
  if (dir.startsWith("packages/")) {
    selfCheck.push(join(STAGING, "node_modules", WORKSPACE_SCOPE, dir.slice("packages/".length), "dist", "index.js"));
  }
}
selfCheck.push(join(STAGING, "plugins", "manifest.json"));
for (const { id } of PLUGINS) selfCheck.push(join(STAGING, "plugins", id, "dist", "index.js"));
for (const required of selfCheck) {
  if (!existsSync(required)) {
    console.error(`staging self-check failed: missing ${required}`);
    process.exit(1);
  }
}
// 自检（manifest 扩展）：每条清单条目带非空 title 与布尔 client，且
// client:true 的渲染层产物真实存在（plugins:list 投影的数据源契约）。
const manifest = JSON.parse(readFileSync(join(STAGING, "plugins", "manifest.json"), "utf8"));
for (const entry of manifest.plugins) {
  if (typeof entry.title !== "string" || entry.title === "") {
    console.error(`staging self-check failed: manifest entry "${entry.id}" lacks a title`);
    process.exit(1);
  }
  if (typeof entry.client !== "boolean") {
    console.error(`staging self-check failed: manifest entry "${entry.id}" lacks a client flag`);
    process.exit(1);
  }
  if (typeof entry.toggleable !== "boolean") {
    console.error(`staging self-check failed: manifest entry "${entry.id}" lacks a toggleable flag`);
    process.exit(1);
  }
  if (entry.core === true && entry.toggleable !== false) {
    console.error(`staging self-check failed: manifest entry "${entry.id}" is core but toggleable`);
    process.exit(1);
  }
  if (entry.client && !existsSync(join(STAGING, "plugins", entry.id, "dist", "client.js"))) {
    console.error(`staging self-check failed: manifest entry "${entry.id}" marks client without dist/client.js`);
    process.exit(1);
  }
}
console.log(`staging assembled at ${STAGING}`);
