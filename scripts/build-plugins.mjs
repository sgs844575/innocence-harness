// 预构建参与分发的包并组装 staging 树：
//   build/dist/resources/node_modules/@innocenceharness/<name>/{dist/,package.json}
//   build/dist/resources/plugins/<id>/{dist/,package.json}
// 增量纪律（dev 启动加速）：build/dist/.plugins-cache.json 记录两类内容指纹——
// 每个工作区包（源码树 + 两级 tsconfig + 根 tsconfig.base.json + package.json +
// 工作区依赖的传递哈希）与外部运行时依赖闭包（各成员 package.json）。指纹未变
// 且 staged 产物在位的包跳过 tsc 与拷贝；变更包经并行工作池重建（直接以
// process.execPath 起 tsc，绕开 npx/cmd 解析开销）。staged 树只会在单包成功
// 构建后被整体替换，失败中断不落半成品。PLUGINS_BUILD_CLEAN=1 强制全量重建
// （怀疑缓存失真或打包前想从零验证时使用）。
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { join, relative, resolve } from "node:path";
import os from "node:os";

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
  // tools-archive dist 值导入 @innocenceharness/tools-fs（resolveWithin）：
  // 该包同时是 plugins/fs 插件，这里补一份 staging node_modules 解析位，
  // 否则打包应用内裸说明符只在开发态经仓库根 node_modules 偶然可达。
  "packages/tools-fs",
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
// web 为网页抓取工具插件（B4F 尾部批次）：默认导出即插件对象（name 同
// id），向 tools 服务注册只读工具 web_fetch——公网正文抓取（环境代理
// 感知传输，同构自模型请求侧形态），SSRF 基线内网/环回字面量拒绝 +
// 重定向每跳重验 + 文本类响应 8KB 截断 + 20s 总时限。
// planflow 为计划提交流插件（B4A 规划工具链）：默认导出即插件对象（name 同
// id），静态形态走通用装载链——注册 plan_submit 工具、监听权限决议事件
// （ask 级 allow 即计划批准）、在消息侧注入批准/拒绝提醒。
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
// computer 为桌面操控工具插件：默认导出即插件对象（name 同 id），仅
// Windows 宿主注册工具——computer_screenshot（虚拟屏幕截屏落 PNG 临时
// 文件并返回路径与分辨率，只读）与 computer_click / computer_type /
// computer_key / computer_scroll（输入注入，PowerShell 无 shell 直调，
// 字符串入参 base64 嵌入）；非 Windows 宿主不注册任何工具。
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
  { id: "web", dependencies: [] },
  { id: "computer", dependencies: [] },
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
  { id: "ask", dependencies: [] },
  { id: "example", dependencies: [] },
];
const PLUGINS = [
  { dir: "packages/plugin-example", id: "example" },
  { dir: "packages/tools-fs", id: "fs" },
  { dir: "packages/tools-shell", id: "shell" },
  { dir: "packages/tools-todo", id: "todo" },
  { dir: "packages/tools-reference", id: "reference" },
  { dir: "packages/tools-web", id: "web" },
  { dir: "packages/tools-computer", id: "computer" },
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
  { dir: "packages/plugin-ask", id: "ask" },
];
const STAGING = "build/dist/resources";
const WORKSPACE_SCOPE = "@innocenceharness";
const EXTERNAL_RUNTIME_PACKAGES = [
  "ai",
  "zod",
  "@ai-sdk/openai",
  "@ai-sdk/openai-compatible",
  "@ai-sdk/anthropic",
  "@ai-sdk/google",
  // 插件 dist 的运行时裸导入：plugin-skills→yaml、harness-ai-runtime→undici、
  // tools-ssh→ssh2、plugin-mcp→ws、tools-archive→yazl+node-forge、
  // tools-fs(read-pdf)→pdfjs-dist（legacy 构建动态导入），与根 package.json
  // 声明保持一致；@ai-sdk/openai-compatible 由 harness-ai-runtime 的
  // model-factory 直引（兼容端点通道）。
  "yaml",
  "undici",
  "ssh2",
  "ws",
  "yazl",
  "node-forge",
  "pdfjs-dist",
];
// 缓存文件位于 resources/ 之外：extraResource 与 packager ignore 都不会带走它。
const CACHE_FILE = "build/dist/.plugins-cache.json";
// 构建/变换逻辑演进时 bump，强制所有缓存键失效。
const CACHE_TOOL_VERSION = 3;
// 编译器与类型环境参与缓存键：npm install 升级 typescript/@types/node 不触碰
// 任何源文件，不加进来就会出现"变了输入却全缓存"的欠失效。
const COMPILER_INPUTS = ["typescript", "@types/node"]
  .map((name) => {
    const pkg = JSON.parse(readFileSync(join("node_modules", ...name.split("/"), "package.json"), "utf8"));
    return `${name}@${pkg.version}`;
  })
  .join(",");
// 并行 tsc 工作池大小：单进程编译器各自单线程，留一核给系统。
const WORKERS = Math.max(2, Math.min(8, os.cpus().length - 1));
const TSC_ENTRY = resolve("node_modules", "typescript", "lib", "tsc.js");

// 运行时 manifest：源 manifest 的 main/exports 指向 src（开发态源码直引），
// staging 副本改指 dist 产物。
function runtimeManifest(pkg) {
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

function readJson(file, fallback) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// 目录内容指纹：相对路径（/ 归一）+ 文件字节，顺序稳定。
function hashTree(hash, root) {
  if (!existsSync(root)) return;
  const walk = (dir) => {
    for (const name of readdirSync(dir).sort()) {
      const file = join(dir, name);
      if (statSync(file).isDirectory()) { walk(file); continue; }
      hash.update(relative(root, file).replaceAll("\\", "/") + "\0");
      hash.update(readFileSync(file));
      hash.update("\0");
    }
  };
  walk(root);
}

// ---- 包条目与工作区元数据 ----------------------------------------------------

const packageEntries = [];
for (const dir of LIBS) packageEntries.push({ dir, kind: "lib", key: `lib:${dir}` });
for (const { dir, id } of PLUGINS) packageEntries.push({ dir, kind: "plugin", id, key: `plugin:${dir}` });

const workspaceDirByName = new Map();
for (const entry of packageEntries) {
  const file = join(entry.dir, "package.json");
  const pkg = JSON.parse(readFileSync(file, "utf8"));
  assertWorkspacePackageMetadata(file, pkg.name);
  entry.name = pkg.name;
  entry.bareName = pkg.name.slice(WORKSPACE_SCOPE.length + 1);
  entry.manifest = runtimeManifest(pkg);
  entry.dependencies = Object.keys({
    ...(pkg.dependencies ?? {}),
    ...(pkg.devDependencies ?? {}),
    ...(pkg.optionalDependencies ?? {}),
    ...(pkg.peerDependencies ?? {}),
  });
  workspaceDirByName.set(pkg.name, entry.dir);
}
// 扫描逐条登记，名册要等全量读完后才齐——这里统一过滤出工作区内依赖。
for (const entry of packageEntries) {
  entry.dependencies = entry.dependencies.filter((name) => workspaceDirByName.has(name));
}

function stagedTarget(entry) {
  return entry.kind === "plugin"
    ? join(STAGING, "plugins", entry.id)
    : join(STAGING, "node_modules", WORKSPACE_SCOPE, entry.bareName);
}

// ---- 内容指纹：自身输入 + 工作区依赖传递哈希 ---------------------------------
// tsc 经 workspace 链接按 src 解析依赖类型，被依赖包源码变化必须令下游失效，
// 因此有效哈希折叠全部工作区依赖（含传递）。环状 devDependency 回边跳过。

const rawHashByDir = new Map();
const effectiveHashByDir = new Map();
const hashingDirs = new Set();

function rawHash(entry) {
  if (rawHashByDir.has(entry.key)) return rawHashByDir.get(entry.key);
  const hash = createHash("sha256");
  hash.update(`tool:${CACHE_TOOL_VERSION}\0compilers:${COMPILER_INPUTS}\0pkg:${entry.dir}\0kind:${entry.kind}\0`);
  if (entry.kind === "plugin") hash.update(`id:${entry.id}\0`);
  hash.update(`base:${readFileSync("tsconfig.base.json")}\0`);
  for (const config of ["tsconfig.build.json", "tsconfig.json", "package.json"]) {
    hash.update(`${config}:${readFileSync(join(entry.dir, config))}\0`);
  }
  hashTree(hash, join(entry.dir, "src"));
  const digest = hash.digest("hex");
  rawHashByDir.set(entry.key, digest);
  return digest;
}

function effectiveHash(entry) {
  const cached = effectiveHashByDir.get(entry.key);
  if (cached) return cached;
  if (hashingDirs.has(entry.key)) return ""; // 环状回边：不折叠，双方各自保持自身指纹
  hashingDirs.add(entry.key);
  const hash = createHash("sha256");
  hash.update(rawHash(entry));
  for (const name of entry.dependencies) {
    const dir = workspaceDirByName.get(name);
    if (!dir) continue;
    const byDir = packageEntries.find((other) => other.dir === dir);
    if (byDir) hash.update(`${name}:${effectiveHash(byDir)}\0`);
  }
  hashingDirs.delete(entry.key);
  const digest = hash.digest("hex");
  effectiveHashByDir.set(entry.key, digest);
  return digest;
}

for (const entry of packageEntries) effectiveHash(entry);

// ---- 外部运行时依赖闭包（拷贝集 = 哈希集，含 optional 传递边） ----------------

function externalDependencyClosure() {
  const names = [];
  const seen = new Set();
  const walk = (name) => {
    if (seen.has(name) || name.startsWith(`${WORKSPACE_SCOPE}/`)) return;
    // 缺席的可选依赖按 npm 语义跳过（如未装原生构建链机器上的 cpu-features/
    // nan）；显式根条目缺席仍由拷贝循环的 existsSync 自检报错。
    if (!existsSync(join("node_modules", ...name.split("/"), "package.json"))) return;
    seen.add(name);
    names.push(name);
    const manifest = JSON.parse(readFileSync(join("node_modules", ...name.split("/"), "package.json"), "utf8"));
    const dependencies = {
      ...(manifest.dependencies ?? {}),
      ...(manifest.optionalDependencies ?? {}),
    };
    for (const dependency of Object.keys(dependencies)) walk(dependency);
  };
  for (const root of EXTERNAL_RUNTIME_PACKAGES) walk(root);
  return names.sort();
}

function externalDependenciesHash(closure) {
  const hash = createHash("sha256");
  hash.update(`tool:${CACHE_TOOL_VERSION}\0`);
  for (const name of closure) {
    hash.update(`${name}:${readFileSync(join("node_modules", ...name.split("/"), "package.json"))}\0`);
  }
  return hash.digest("hex");
}

// ---- 主流程 ------------------------------------------------------------------

const cleanBuild = process.env.PLUGINS_BUILD_CLEAN === "1";
if (cleanBuild) rmSync("build/dist", { recursive: true, force: true });
const cache = (() => {
  const loaded = readJson(CACHE_FILE, null);
  if (!isPlainObject(loaded)) return { packages: {}, runtimeDeps: { hash: "", copiedDirs: [] } };
  return {
    packages: isPlainObject(loaded.packages) ? loaded.packages : {},
    runtimeDeps: isPlainObject(loaded.runtimeDeps) && typeof loaded.runtimeDeps.hash === "string" && Array.isArray(loaded.runtimeDeps.copiedDirs)
      ? loaded.runtimeDeps
      : { hash: "", copiedDirs: [] },
  };
})();

// 外部运行时依赖：闭包指纹变化（或 staged 副本被删）才整棵重拷。
const closure = externalDependencyClosure();
const closureSet = new Set(closure);
if (externalDependenciesHash(closure) !== cache.runtimeDeps.hash ||
    cache.runtimeDeps.copiedDirs.some((dir) => !existsSync(join(STAGING, "node_modules", ...dir.split("/"), "package.json")))) {
  for (const dir of cache.runtimeDeps.copiedDirs) {
    if (!closureSet.has(dir)) rmSync(join(STAGING, "node_modules", ...dir.split("/")), { recursive: true, force: true });
  }
  for (const name of closure) {
    const source = join("node_modules", ...name.split("/"));
    if (!existsSync(source)) {
      console.error(`staging dependency missing from node_modules: ${name}`);
      process.exit(1);
    }
    cpSync(source, join(STAGING, "node_modules", ...name.split("/")), { recursive: true });
  }
  cache.runtimeDeps = { hash: externalDependenciesHash(closure), copiedDirs: closure };
} else {
  console.log(`staging runtime dependencies up to date (${closure.length} packages)`);
}

// 包构建计划：指纹未变且 staged dist 在位（入口产物存在）才跳过。
const stale = [];
const packageHashes = {};
for (const entry of packageEntries) {
  const digest = effectiveHashByDir.get(entry.key);
  packageHashes[entry.key] = digest;
  const stagedEntry = join(stagedTarget(entry), "dist", "index.js");
  if (cache.packages[entry.key] === digest && existsSync(stagedEntry)) continue;
  stale.push(entry);
}
// 同一包目录可能对应多个 staging 目标（如 tools-fs 既是 plugins/fs 又是 lib）：
// tsc 按目录去重只跑一次，成功后落到它的全部目标，避免并发写同一 dist。
const staleUnits = [];
for (const entry of stale) {
  const unit = staleUnits.find((candidate) => candidate.dir === entry.dir);
  if (unit) unit.entries.push(entry);
  else staleUnits.push({ dir: entry.dir, entries: [entry] });
}

function stagePackage(entry) {
  const target = stagedTarget(entry);
  rmSync(target, { recursive: true, force: true });
  cpSync(join(entry.dir, "dist"), join(target, "dist"), { recursive: true });
  writeFileSync(join(target, "package.json"), JSON.stringify(entry.manifest, null, 2) + "\n", "utf8");
}

// 并行构建池：进程失败不落 staging（staged 树保持上一好版本），全量跑完后
// 统一报告失败并退出；成功者就地补扩展名后拷入 staging。
function buildStale(units) {
  return new Promise((resolvePromise) => {
    const failures = [];
    let cursor = 0;
    let active = 0;
    const launch = () => {
      while (active < WORKERS && cursor < units.length) {
        const unit = units[cursor++];
        active++;
        console.log(`  building ${unit.dir} (${cursor}/${units.length})`);
        const child = spawn(process.execPath, [TSC_ENTRY, "-p", join(unit.dir, "tsconfig.build.json")], {
          stdio: ["ignore", "pipe", "pipe"],
        });
        let output = "";
        child.stdout.on("data", (chunk) => { output += chunk; });
        child.stderr.on("data", (chunk) => { output += chunk; });
        const settle = () => {
          active--;
          if (active === 0 && cursor >= units.length) resolvePromise(failures);
          else launch();
        };
        child.on("error", (error) => {
          failures.push({ dir: unit.dir, output: error.message });
          settle();
        });
        child.on("close", (code) => {
          if (code === 0) {
            try {
              fixDist(unit.dir);
              for (const entry of unit.entries) stagePackage(entry);
            } catch (error) {
              failures.push({ dir: unit.dir, output: `${error}` });
            }
          } else {
            failures.push({ dir: unit.dir, output });
          }
          settle();
        });
      }
      if (active === 0 && cursor >= units.length) resolvePromise(failures);
    };
    launch();
  });
}

for (const unit of staleUnits) rmSync(join(unit.dir, "dist"), { recursive: true, force: true });
const failures = await buildStale(staleUnits);
if (failures.length > 0) {
  for (const failure of failures) {
    console.error(`build failed: ${failure.dir}\n${failure.output}`);
  }
  process.exit(1);
}

// 对账：清单之外的陈旧 staged 目录（包被移除/改名后遗留）清掉。
const pluginIds = new Set(PLUGINS.map(({ id }) => id));
const pluginsRoot = join(STAGING, "plugins");
if (existsSync(pluginsRoot)) {
  for (const name of readdirSync(pluginsRoot)) {
    if (name === "manifest.json" || pluginIds.has(name)) continue;
    rmSync(join(pluginsRoot, name), { recursive: true, force: true });
  }
}
const libNames = new Set(packageEntries.filter((entry) => entry.kind === "lib").map((entry) => entry.bareName));
const libsRoot = join(STAGING, "node_modules", WORKSPACE_SCOPE);
if (existsSync(libsRoot)) {
  for (const name of readdirSync(libsRoot)) {
    if (libNames.has(name)) continue;
    rmSync(join(libsRoot, name), { recursive: true, force: true });
  }
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
for (const entry of packageEntries) {
  if (entry.kind === "lib") selfCheck.push(join(stagedTarget(entry), "dist", "index.js"));
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

mkdirSync("build/dist", { recursive: true });
writeFileSync(
  CACHE_FILE,
  JSON.stringify({ packages: packageHashes, runtimeDeps: cache.runtimeDeps }, null, 2) + "\n",
  "utf8",
);
console.log(`staging assembled at ${STAGING} (${stale.length} rebuilt, ${packageEntries.length - stale.length} cached)`);
