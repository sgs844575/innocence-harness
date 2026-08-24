# InnocenceHarness 全面命名迁移设计规格

> 日期：2026-08-24
>
> 范围：将项目从 InnocenceCode / innocencecode 彻底迁移为 InnocenceHarness / innocenceharness，包括包作用域、应用协议、插件协议、环境变量、Forge 产物、测试 fixture 和用户可见文案。

## 1. 目标

本次迁移是一次有意的破坏性命名迁移，不保留旧协议或旧包作用域作为运行时兼容入口。完成后：

- 产品品牌为 `InnocenceHarness`。
- 根 npm 包名为 `innocenceharness`。
- 所有 workspace/vendor 包作用域为 `@innocenceharness/*`。
- 主应用协议为 `innocenceharness://`。
- 插件资源协议为 `innocenceharness-plugin://`。
- 测试环境变量使用 `INNOCENCEHARNESS_TEST_*` 前缀。
- smoke 环境变量使用 `InnocenceHarness_SMOKE_OUT`。
- Forge executable、安装程序、输出目录和 smoke 路径使用 `InnocenceHarness`。
- 运行时代码、构建产物、workspace 依赖、测试 fixture 和文档不再残留旧运行时命名。

## 2. 兼容边界

以下磁盘数据路径暂时保留，不进行目录迁移或删除：

- 用户目录：`~/.innocence`。
- 项目目录：`.innocence`。
- 已有会话、任务、插件和配置文件路径。

保留这些路径只用于避免破坏用户数据，不构成旧品牌运行时入口。所有协议、包作用域、环境变量和构建产物都必须切换到新名称。

## 3. 目标映射

| 类别 | 旧名称 | 新名称 | 处理方式 |
| --- | --- | --- | --- |
| 产品品牌 | `InnocenceCode` | `InnocenceHarness` | 全量迁移 |
| 根 npm 包 | `innocencecode` | `innocenceharness` | 全量迁移并同步 lockfile |
| workspace 作用域 | `@innocencecode/*` | `@innocenceharness/*` | 全量迁移，无 alias |
| 主应用协议 | `innocencecode://` | `innocenceharness://` | 旧 scheme 不再注册 |
| 插件协议 | `innocence-plugin://` | `innocenceharness-plugin://` | 旧 scheme 不再注册 |
| 测试环境变量 | `INNOCENCE_TEST_*` | `INNOCENCEHARNESS_TEST_*` | 全量迁移 |
| smoke 输出变量 | `InnocenceCode_SMOKE_OUT` | `InnocenceHarness_SMOKE_OUT` | 全量迁移 |
| Forge executable | `InnocenceCode.exe` | `InnocenceHarness.exe` | 全量迁移 |
| Forge setup | `InnocenceCodeSetup.exe` | `InnocenceHarnessSetup.exe` | 全量迁移 |
| Forge 输出目录 | `out/InnocenceCode-*` | `out/InnocenceHarness-*` | 全量迁移 |

## 4. 包作用域迁移

### 4.1 包元数据

更新所有 `packages/*/package.json`、`vendor/*/package.json`、根 `package.json` 和 `package-lock.json`：

- `name` 从 `@innocencecode/<name>` 改为 `@innocenceharness/<name>`。
- `dependencies`、`devDependencies`、`peerDependencies`、`optionalDependencies` 中的旧作用域全部替换。
- repository directory、description、README、exports 和 workspace 相关元数据同步新作用域或新品牌。
- 依赖锁文件中每个 workspace package key、名称和依赖边全部一致。

### 4.2 源码和构建

更新所有 TypeScript import/export、类型增强声明、动态 resolver、staging 构建脚本和 manifest：

- 静态 import 使用 `@innocenceharness/*`。
- `scripts/build-plugins.mjs` 的 staging node_modules 目录改为 `build/dist/resources/node_modules/@innocenceharness`。
- runtime manifest 的作用域剥离、self-check 和 resolver roots 与新作用域一致。
- `vendor/kernel-loader`、session spine、provider、plugin 和 task 包的跨包导入全部更新。
- 不保留旧作用域 fallback、双写 package 或兼容 alias。

### 4.3 验收

- `git grep` 在运行时 source、workspace package metadata、构建脚本和测试中找不到 `@innocencecode/`。
- `npm install` 后 workspace resolution 成功。
- `npm run build:plugins` 产出新作用域 staging node_modules 和可加载 manifest。
- `npm run typecheck:packages` 全部通过。
- loader、provider、skills、MCP、subagent 和 task plugin 的现有行为测试继续通过。

## 5. 应用协议迁移

### 5.1 主应用 scheme

在 `src/main/protocol.ts`：

- `APP_SCHEME = "innocenceharness"`。
- `appIndexUrl()` 返回 `innocenceharness://app/index.html`。
- `registerAppScheme()` 和 `handleAppScheme()` 只注册新 scheme。
- `src/main/appWindow.ts` 的允许导航 origin、注释和测试期望同步新 scheme。
- CSP、renderer HTML、protocol tests 和 packaged smoke 的 app URL 同步新 scheme。
- 旧 `innocencecode://` 不再注册、不再允许导航、不再作为 fallback。

### 5.2 插件 scheme

在同一协议模块及所有 client loader 中：

- `PLUGIN_SCHEME = "innocenceharness-plugin"`。
- `clientModuleUrl(id, revision?)` 使用 `innocenceharness-plugin://<id>/dist/client.js`。
- HMR query cache-busting 保持在新 scheme URL 上。
- protocol handler 仍按 URL hostname/pathname 做 plugin id、路径 containment、双根查找和 MIME/CORS 响应；query 不改变文件路径。
- `src/webview/index.html` CSP 的 plugin source 更新为新 scheme。
- UI loader、loader tests、protocol tests、真实 Electron acceptance fixture 和 HMR tests 全部改用新 scheme。
- 旧 `innocence-plugin://` 不再注册、不再作为 fallback。

### 5.3 验收

新增协议迁移断言：

- 新主应用 URL 可加载 renderer index。
- 新插件 URL 能从用户根优先、内置根回落加载 fixture client。
- query cache-busting 读取同一 pathname 文件。
- 旧 scheme 请求被拒绝或没有 registered handler，不能成功加载资源。
- CSP 不包含旧 scheme。

## 6. 环境变量和测试启动迁移

### 6.1 环境变量

更新所有主进程、preload、测试 runner、Forge smoke、fixture launcher 和文档：

- `INNOCENCE_TEST_MODE` → `INNOCENCEHARNESS_TEST_MODE`。
- `INNOCENCE_TEST_USER_DATA` → `INNOCENCEHARNESS_TEST_USER_DATA`。
- `INNOCENCE_TEST_USER_PLUGIN_ROOT` → `INNOCENCEHARNESS_TEST_USER_PLUGIN_ROOT`。
- `INNOCENCE_TEST_BUILTIN_PLUGIN_ROOT` → `INNOCENCEHARNESS_TEST_BUILTIN_PLUGIN_ROOT`。
- `INNOCENCE_TEST_EXTERNAL_UI_PACKAGE_DIR` → `INNOCENCEHARNESS_TEST_EXTERNAL_UI_PACKAGE_DIR`。
- `InnocenceCode_SMOKE_OUT` → `InnocenceHarness_SMOKE_OUT`。

测试 override 仍必须经过已有 controlled marker + packaged argument gate；只改变变量名称，不放宽安全边界。

### 6.2 验收

- 新变量能驱动 dev acceptance、packaged acceptance 和 smoke fixture。
- 旧变量不会影响运行时。
- 普通 packaged 启动即使继承旧/新测试变量，也不会重定向生产 userData 或 plugin roots，除非同时满足受控测试启动条件。
- `git grep` 运行时 source、测试和 scripts 不得残留旧 `INNOCENCE_TEST_` 或 `InnocenceCode_SMOKE_OUT`。

## 7. Forge、staging 和 smoke 产物

### 7.1 Forge

同步更新：

- `forge.config.ts` 的 executable、Squirrel name/setup、maker 期望和输出文案。
- `scripts/packaging/outPreflight.ts` 的 known package pattern。
- `scripts/packaging/runPackageSmoke.ts`、packaged-exit acceptance 的 executable 和 package directory。
- `scripts/packaging/packagedAvailability.ts` 的 package 产物判定。
- `package.json` package scripts 和输出诊断。
- 测试 fixture 的 package directory 和 skip 诊断。

### 7.2 Staging

- staging plugins、node_modules、manifest 和 package self-check 使用新作用域和新产品名。
- `extraResource`、asar unpack、native prune 不改变功能，仅更新路径/诊断文案。
- package smoke required gate 继续保持：缺 executable/archive/smoke entry 返回非零；普通 `npm test` 的 packaged acceptance 可明确 skip。

### 7.3 验收

```cmd
npm run build:plugins
npm run package:preflight
npm run package
npm run package:smoke
```

必须记录每个命令的实际退出码。只看到新产物、`PKG_SMOKE pty ok`、`PKG_SMOKE task ok`、`PKG_SMOKE lockfiles 0`、`PKG_SMOKE done` 和残留 sweep 清洁时，才能声明 packaged smoke 通过。

## 8. 用户界面和文案

更新以下用户可见内容：

- README 标题、图标 alt、品牌介绍和自举说明。
- Electron 菜单 About、窗口标题、启动失败文案、中文/英文 locale。
- React App 名称、HTML title、设置/聊天辅助文案和系统提示词。
- package description、Forge 日志和测试诊断中的产品名称。

内部协议字符串、包作用域和用户数据路径分别按第 4–7 节处理，不能只改显示文案后遗漏运行时入口。

## 9. 错误处理和迁移失败策略

- 任一旧作用域包仍被 resolver 请求：立即失败并报告具体 specifier。
- 新协议注册失败或旧 scheme 仍可加载：测试失败，不回退旧 scheme。
- manifest、staging node_modules 或 package lock 不一致：`build:plugins` 失败，不生成部分可用 staging。
- 新测试变量缺少 controlled marker：忽略 override 或明确拒绝，不能静默改变生产路径。
- package 输出被锁：`package:preflight` 有限重试后非零退出，报告路径/error/cause，不强杀未知进程。
- 用户 `.innocence` 数据读取失败：沿用现有错误处理，不删除、重写或自动迁移用户数据。

## 10. 测试矩阵

### Node/Vitest

- 包作用域 resolver、manifest、build staging self-check。
- 主应用 scheme 和插件 scheme 新名称、旧名称拒绝、query cache-busting。
- loader/client URL、HMR revision、protocol 双根和失败隔离。
- 环境变量 gate、旧变量无效、新变量受控生效。
- Forge package pattern、out preflight、reparse、packagedAvailability 和 required smoke runner。

### Renderer/jsdom

- loader 新插件 URL、panel/settings/toolcard 注册和撤销。
- HMR revision 触发新模块 URL 和真实 client replacement。
- React App/菜单/错误文案改名后的渲染回归。

### 真实 Electron

- 新 `innocenceharness://` renderer 加载。
- 新 `innocenceharness-plugin://` fixture client 动态加载。
- 外部 panel/settings 显示与停用撤销。
- HMR event 通过 typed IPC 到 renderer，刷新 inventory 和 client module。
- child、DevTools socket、窗口和临时目录完整清理。

### Workspace/Forge

```cmd
npm install
npm run typecheck
npm run typecheck:packages
npm test
npm run build:plugins
npm run package:preflight
npm run package
npm run package:smoke
```

## 11. 禁止残留检查

迁移完成前必须执行以下检查：

- 运行时 source、protocol、renderer、preload、scripts 和 tests 中不存在 `innocencecode://`。
- 运行时 source、workspace metadata、imports 和 resolver 中不存在 `@innocencecode/`。
- 运行时 source、scripts 和 tests 中不存在旧 `innocence-plugin://`。
- 运行时环境变量中不存在旧 `INNOCENCE_TEST_` 和 `InnocenceCode_SMOKE_OUT`。
- `InnocenceCode.exe`、`InnocenceCodeSetup.exe`、`out/InnocenceCode-*` 不再作为新构建目标出现。
- 允许保留的只有历史提交、远端 URL、用户数据目录和明确标注为迁移 fixture 的旧路径样本；这些不能参与运行时解析。

## 12. 完成定义

只有满足以下全部条件才算迁移完成：

1. 根包、workspace 包、vendor 包、lockfile 和所有 import 已切换到 `@innocenceharness/*`。
2. 新主应用和插件协议能完成真实加载，旧协议不能加载资源。
3. 新环境变量、Forge 产物和 smoke runner 全部使用新命名并通过 required gate。
4. `npm run build:plugins`、两套 typecheck 和 `npm test` 通过。
5. 新产物上的 `npm run package` 成功，`npm run package:smoke` 返回 0 且输出完整 smoke markers 和 residue sweep。
6. 真实 Electron acceptance 使用新协议和 fixture 通过。
7. `.innocence` 用户数据保持可读取，未被删除或无提示重写。
8. 禁止残留检查只留下允许的历史/数据路径样本。
