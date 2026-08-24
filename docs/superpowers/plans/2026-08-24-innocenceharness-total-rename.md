# InnocenceHarness 全面命名迁移实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 `superpowers-zh:subagent-driven-development`（推荐）或 `superpowers-zh:executing-plans` 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法跟踪进度。

**目标：** 将运行时包作用域、主应用协议、插件协议、测试环境变量、Forge 产物和用户可见文案从旧命名全面迁移到 InnocenceHarness，并以新产物完成验证。

**架构：** 新 namespace `@innocenceharness/*` 贯穿 package metadata、TypeScript import、声明合并、staging node_modules 和动态 resolver；新应用/插件 scheme 分别为 `innocenceharness://` 和 `innocenceharness-plugin://`。旧运行时入口不保留 alias；`.innocence` 与 `~/.innocence` 仅作为既有用户数据路径保留，不参与品牌协议或包作用域兼容。

**技术栈：** TypeScript、npm workspaces、Node fs/path、Electron Forge、Vite、Vitest、Electron protocol、真实 Electron acceptance。

---

## 全局约束

- 这是破坏性迁移：旧 `@innocencecode/*`、`innocencecode://`、`innocence-plugin://`、`INNOCENCE_TEST_*` 和 `InnocenceCode_SMOKE_OUT` 不得保留为运行时 fallback 或 alias。
- 保留 `~/.innocence`、`.innocence` 和历史数据文件路径，防止删除或无提示重写用户现有数据。
- 遵守 `AGENTS.md`：领域包不得导入 host framework；host/renderer 只通过 typed ports、adapter、IPC 和 slot registry 集成；每个资源 owner 显式释放资源。
- 不覆盖不相关工作树改动；所有文本使用 UTF-8 安全编辑。
- `docs/` 只存本地规划材料，遵守仓库规则，不在实现提交中加入新的 docs/spec/report 文件。
- 子代理、后台命令或异步工具结果必须阻塞等待完成、明确失败或用户取消；不设置短超时轮询。
- 不把协议、包作用域、环境变量或用户数据路径的旧名称作为兼容 alias 留在运行时。

## 文件与模块职责

### Namespace 与 staging

- 修改：根 `package.json`、`package-lock.json`、`packages/*/package.json`、`vendor/*/package.json` —— 新 `@innocenceharness/*` package names 和依赖边。
- 修改：所有受影响的 `packages/*/src/**`、`vendor/*/src/**`、`src/**`、测试中的 import specifier、module augmentation specifier 和 dynamic resolver expectation。
- 修改：`scripts/build-plugins.mjs` —— 新 staging namespace、manifest self-check 和 runtime package mapping。
- 测试：各 package 已有 Vitest suites、`src/main/pluginBoot.integration.test.ts`、loader/resolver tests。

### Protocol 与 client URL

- 修改：`src/main/protocol.ts`、`src/main/protocol.test.ts`、`src/main/index.ts`、`src/main/appWindow.ts`、`src/webview/index.html`。
- 修改：`src/webview/src/pluginClient/loader.ts`、`loader.test.tsx`、`src/webview/src/state/usePluginClients.ts`、其测试。
- 修改：`tests/external-ui.acceptance.test.ts` 和 fixture client build/expectations。

### Test override 与 packaged smoke

- 修改：`src/main/testOverrides.ts`、`testOverrides.test.ts`、`src/main/index.ts`、`src/main/harnessGlue.ts`。
- 修改：`scripts/packaging/runPackageSmoke.ts`、`packagedAvailability.ts`、其测试、`tests/packaged-exit.acceptance.test.ts`、`forge.config.ts`、`package.json`。
- 修改：`scripts/packaging/outPreflight.ts`、`outPreflight.test.ts`、native prune tests。

### User-visible product identity

- 修改：`README.md`、`AGENTS.md`、root `package.json`、`forge.config.ts`、locale files、HTML title、App/menu/system prompt/renderer title names、workspace package descriptions。
- 测试：品牌相关 UI, i18n, packaging path expectations。

---

## 任务 1：迁移 workspace/vendor 包作用域和 staging namespace

**交付物：** 所有 workspace/vendor package metadata、跨包 import、类型声明和 staging node_modules 使用 `@innocenceharness/*`，旧作用域无法再被 resolver 解析。

**文件：**

- 修改：根 `package.json`、`package-lock.json`。
- 修改：`packages/*/package.json`、`vendor/*/package.json`。
- 修改：所有含 `@innocencecode/` 的 production/test TypeScript 文件。
- 修改：`scripts/build-plugins.mjs`。
- 测试：`vendor/kernel-loader/tests/resolver.spec.ts`、`vendor/kernel-loader/tests/loader-composition.spec.ts`、`src/main/pluginBoot.integration.test.ts`、各 package typecheck。

- [ ] **步骤 1：编写失败的 namespace/staging 测试**

在 loader resolver 和 staging boot 测试中先断言新 namespace：

```ts
expect(path.join(stagingRoot, "node_modules", "@innocenceharness", "kernel", "dist", "index.js"))
  .toSatisfy(existsSync);
await expect(resolver.import("@innocenceharness/kernel")).resolves.toBeDefined();
await expect(resolver.import("@innocencecode/kernel")).rejects.toThrow();
```

在 build self-check 测试中要求 manifest 依赖与 staging package metadata 使用新 scope。

- [ ] **步骤 2：运行测试确认失败**

运行：

```cmd
npx vitest run vendor/kernel-loader/tests/resolver.spec.ts vendor/kernel-loader/tests/loader-composition.spec.ts src/main/pluginBoot.integration.test.ts
```

预期：新作用域路径或 resolver import 不存在，旧 scope 仍可解析。

- [ ] **步骤 3：迁移 package metadata、imports 和 staging**

1. 使用 repository-aware Node migration script 或精确编辑，将 `@innocencecode/` 替换为 `@innocenceharness/`，覆盖：
   - package `name` 和 workspace dependency declarations；
   - TS static imports、type imports、module augmentations；
   - test imports、fixtures 和 dynamic resolver expectations；
   - `scripts/build-plugins.mjs` 中 namespace staging target、scope stripping、self-check。
2. 根 `package.json.name` 与 lockfile root package key 保持 `innocenceharness`。
3. 重新生成或用 npm 同步 `package-lock.json`，确认没有旧 workspace package names/edges。
4. 不改 `.innocence` 磁盘目录，也不保留旧 scope resolver alias。

目标 staging 形态：

```text
build/dist/resources/node_modules/@innocenceharness/<package>/dist/index.js
build/dist/resources/plugins/<plugin-id>/dist/index.js
```

- [ ] **步骤 4：运行 package/build 与定向测试**

运行：

```cmd
npm install
npm run build:plugins
npx vitest run vendor/kernel-loader/tests/resolver.spec.ts vendor/kernel-loader/tests/loader-composition.spec.ts src/main/pluginBoot.integration.test.ts
npm run typecheck:packages
```

预期：新 scope 的 staging import、loader plugin resolution 和 typecheck 均通过；旧 scope resolver test 明确失败。

- [ ] **步骤 5：检查旧作用域残留并提交**

运行：

```cmd
git grep -n "@innocencecode/" -- .
```

预期：没有运行时、package metadata、import 或测试残留；若保留任何历史样本，必须在迁移 allowlist 中逐条解释，且不能参与构建/解析。

提交：

```cmd
git add package.json package-lock.json packages vendor scripts src tests
git commit -m "refactor(namespace): migrate workspace packages to InnocenceHarness"
```

---

## 任务 2：迁移主应用、插件协议与动态 client URL

**交付物：** 新主 scheme `innocenceharness://` 和新插件 scheme `innocenceharness-plugin://` 完成 renderer/插件加载；旧 scheme 不注册、不加载资源。

**文件：**

- 修改：`src/main/protocol.ts`、`src/main/protocol.test.ts`、`src/main/index.ts`、`src/main/appWindow.ts`。
- 修改：`src/webview/index.html`、`src/webview/src/pluginClient/loader.ts`、`loader.test.tsx`、`src/webview/src/state/usePluginClients.ts`、其测试。
- 修改：`tests/external-ui.acceptance.test.ts`、`tests/fixtures/external-ui-plugin/*`。

- [ ] **步骤 1：编写失败协议与 URL 测试**

新增或更新测试：

```ts
expect(APP_SCHEME).toBe("innocenceharness");
expect(PLUGIN_SCHEME).toBe("innocenceharness-plugin");
expect(appIndexUrl()).toBe("innocenceharness://app/index.html");
expect(clientModuleUrl("fixture", 7))
  .toBe("innocenceharness-plugin://fixture/dist/client.js?hmr=7");
```

同时验证：

```ts
await expect(handleOldScheme("innocencecode://app/index.html")).rejects.toThrow();
await expect(handleOldScheme("innocence-plugin://fixture/dist/client.js")).rejects.toThrow();
```

插件 handler 回归必须确认新 URL 带 `?hmr=7` 时仍读取相同 pathname 文件。

- [ ] **步骤 2：运行测试确认失败**

运行：

```cmd
npx vitest run src/main/protocol.test.ts src/webview/src/pluginClient/loader.test.tsx src/webview/src/state/usePluginClients.test.tsx
```

预期：当前常量、CSP 或 dynamic import URL 仍使用旧 scheme，测试失败。

- [ ] **步骤 3：切换协议和 CSP**

1. 修改 protocol constants、privileged registration、handler 和 `appIndexUrl()`。
2. 更新 `appWindow.ts` 的 navigation whitelist。
3. 将 CSP source 从 `innocence-plugin:` 改为 `innocenceharness-plugin:`。
4. `clientModuleUrl`、HMR revision URL、loader tests、fixture expectations 使用新 plugin scheme。
5. 不注册旧 schemes；旧 URL 访问不可成功加载任何资源。
6. 保持 hostname/pathname containment、MIME、CORS、query cache-busting 和双根 shadow 行为不变。

- [ ] **步骤 4：运行协议/renderer/真实 Electron 验证**

运行：

```cmd
npx vitest run src/main/protocol.test.ts src/webview/src/pluginClient/loader.test.tsx src/webview/src/state/usePluginClients.test.tsx tests/external-ui.acceptance.test.ts
npm run typecheck
```

预期：新 scheme 下 fixture client 的 panel/settings 显示与撤销通过；带 revision 的 import URL 加载新模块；旧 scheme 无运行时 handler。

- [ ] **步骤 5：提交**

```cmd
git add src/main/protocol.ts src/main/protocol.test.ts src/main/index.ts src/main/appWindow.ts src/webview tests
git commit -m "refactor(protocol): migrate application and plugin schemes"
```

---

## 任务 3：迁移测试变量、受控启动与 smoke 名称

**交付物：** 全部测试变量使用 `INNOCENCEHARNESS_*`，生产 override gate 保持严格；新 smoke output 名称和 test launcher 生效，旧变量不会改变运行时。

**文件：**

- 修改：`src/main/testOverrides.ts`、`src/main/testOverrides.test.ts`、`src/main/index.ts`、`src/main/harnessGlue.ts`。
- 修改：`tests/external-ui.acceptance.test.ts`、smoke runner/fixture tests。
- 修改：`src/main/appWindow.ts`、`src/main/packageSmoke.ts`、`tools/smoke-test.cjs`（若存在旧变量）。
- 修改：`scripts/packaging/runPackageSmoke.ts`、tests、`tests/packaged-exit.acceptance.test.ts`。

- [ ] **步骤 1：编写失败变量 gate 测试**

在 `testOverrides.test.ts` 先锁定新变量和旧变量拒绝：

```ts
expect(resolveTestOverrides({
  isPackaged: false,
  env: { INNOCENCEHARNESS_TEST_MODE: "1", INNOCENCEHARNESS_TEST_USER_DATA: "C:/test/data" },
  argv: [],
})).toMatchObject({ enabled: true, userData: "C:/test/data" });

expect(resolveTestOverrides({
  isPackaged: false,
  env: { INNOCENCE_TEST_MODE: "1", INNOCENCE_TEST_USER_DATA: "C:/old/data" },
  argv: [],
})).toEqual({ enabled: false });
```

更新 smoke test 断言：`InnocenceHarness_SMOKE_OUT` 驱动 load report，旧变量不驱动。

- [ ] **步骤 2：运行测试确认失败**

运行：

```cmd
npx vitest run src/main/testOverrides.test.ts scripts/packaging/runPackageSmoke.test.ts tests/external-ui.acceptance.test.ts
```

预期：新变量未被识别，旧变量仍可能工作。

- [ ] **步骤 3：实现变量全面迁移**

1. 将所有 `INNOCENCE_TEST_*` 修改为对应 `INNOCENCEHARNESS_TEST_*`。
2. 将 `InnocenceCode_SMOKE_OUT` 修改为 `InnocenceHarness_SMOKE_OUT`。
3. 保持 packaged override 必须同时有新 mode marker 与受控启动参数；普通 production 忽略所有新测试路径变量。
4. fixture launcher 只传新变量；测试 failure diagnostics 同步新变量名称。
5. 旧变量没有 fallback、没有 alias、没有读取分支。

- [ ] **步骤 4：运行变量/真实 UI/smoke 定向验证**

运行：

```cmd
npx vitest run src/main/testOverrides.test.ts scripts/packaging/runPackageSmoke.test.ts tests/external-ui.acceptance.test.ts tests/packaged-exit.acceptance.test.ts
npm run typecheck
```

预期：新 controlled variables 生效；旧 variables 无效；真实 Electron acceptance 使用新变量运行；smoke required gate 仍对缺产物非零。

- [ ] **步骤 5：提交**

```cmd
git add src/main src/preload scripts tests tools package.json
git commit -m "refactor(runtime): migrate test and smoke environment names"
```

---

## 任务 4：迁移 Forge、out 目录、package smoke 与 staging output 名称

**交付物：** 新 executable、setup、output directory 和 package smoke 路径均使用 `InnocenceHarness`，required smoke 对新产物验证且旧产物名不再作为目标。

**文件：**

- 修改：`forge.config.ts`、`package.json`、`scripts/build-plugins.mjs`。
- 修改：`scripts/packaging/outPreflight.ts`、`outPreflight.test.ts`、`packagedAvailability.ts`、`runPackageSmoke.ts`、其测试。
- 修改：`tests/packaged-exit.acceptance.test.ts`、`tests/packaged-exit.availability.test.ts`、native prune tests。

- [ ] **步骤 1：编写失败 package path 测试**

更新 package tests：

```ts
expect(defaultPackageDirectory(repoRoot))
  .toBe(path.join(repoRoot, "out", "InnocenceHarness-win32-x64"));
expect(defaultExecutableName()).toBe("InnocenceHarness.exe");
expect(() => assertKnownPackageDirectory(path.join(repoRoot, "out", "InnocenceCode-win32-x64")))
  .toThrow();
```

同时修改 Forge config tests（或新增针对 config object 的 test）断言 executable/setup 名称。

- [ ] **步骤 2：运行测试确认失败**

运行：

```cmd
npx vitest run scripts/packaging/outPreflight.test.ts scripts/packaging/runPackageSmoke.test.ts tests/packaged-exit.availability.test.ts tests/packaged-exit.acceptance.test.ts tests/packaging/nodePtyPrebuilds.test.ts
```

预期：旧 product output pattern 和 executable expectation 导致失败。

- [ ] **步骤 3：实现新产物命名**

1. Forge executable、maker name/setup 和 product metadata 统一为 `InnocenceHarness`。
2. `outPreflight` known package pattern 只接受 `InnocenceHarness-<platform>-<arch>`。
3. packaged availability、required smoke runner 和 packaged exit acceptance 使用 `InnocenceHarness.exe` 与新 package directory。
4. staging new scope/self-check 使用 `@innocenceharness`。
5. 旧 output name 不能通过 required smoke 或 preflight allowlist。

- [ ] **步骤 4：运行 build、preflight 和 package 验证**

运行：

```cmd
npm run build:plugins
npm run package:preflight
npm run package
npm run package:smoke
```

记录每项退出码。若 `out` 锁存在：preflight 必须报告新 output 路径、EBUSY、有限次数和 cause，不能误报成功或强杀未知进程。

- [ ] **步骤 5：提交**

```cmd
git add forge.config.ts package.json scripts tests
 git commit -m "chore(packaging): migrate InnocenceHarness artifacts"
```

---

## 任务 5：迁移剩余用户可见文本、系统提示和仓库名称引用

**交付物：** 用户可见产品名、系统提示、package descriptions、README、locale、HTML/renderer 标题和 test expectations 统一为 `InnocenceHarness`，不改兼容数据路径。

**文件：**

- 修改：`README.md`、`AGENTS.md`、root/package README、workspace/vendor README/description。
- 修改：`src/main/locales/*.json`、`src/main/menu.ts`、`src/webview/index.html`、`src/webview/src/App.tsx`、`src/webview/src/lib/i18n.ts`、`src/webview/src/main.tsx`。
- 修改：`packages/harness-electron/src/agents.ts`、其 tests 和产品名 snapshot assertions。

- [ ] **步骤 1：编写失败 UI/system prompt 文案测试**

新增或更新断言：

```ts
expect(screen.getByText("InnocenceHarness")).toBeTruthy();
expect(DEFAULT_SYSTEM_PROMPT).toContain("InnocenceHarness");
expect(createT("en-US")("menu.help.about")).toContain("InnocenceHarness");
```

- [ ] **步骤 2：运行测试确认失败**

运行：

```cmd
npx vitest run src/webview/src/lib/i18n.test.ts src/webview/src/components/ChatView.test.tsx packages/harness-electron/tests/agents.test.ts
```

预期：旧 display string 或 snapshot expectation 失败。

- [ ] **步骤 3：更新可见文本**

1. 更新 product title、About、startup error、README、package descriptions 和 default system prompts。
2. 更新 locale key values，不改 stable locale key identifiers。
3. 保留 `.innocence`、`~/.innocence`、内部 IPC type names、历史 Git URL 之外的兼容 data paths，直到专门的数据迁移计划批准。

- [ ] **步骤 4：运行文案测试与类型检查**

运行：

```cmd
npx vitest run src/webview/src/lib/i18n.test.ts src/webview/src/components/ChatView.test.tsx packages/harness-electron/tests/agents.test.ts
npm run typecheck
```

- [ ] **步骤 5：提交**

```cmd
git add README.md AGENTS.md package.json packages src tests
 git commit -m "chore(branding): complete InnocenceHarness product text"
```

---

## 任务 6：禁止残留检查、完整验证与迁移验收

**交付物：** 新 namespace/protocol/package artifacts 在真实 build 与 Electron 中工作，旧运行时入口没有残留；最终命令有新鲜、可追溯证据。

**文件：**

- 修改：只在必要时调整残留检查 tests；不创建或提交新的 docs/report 文件。
- 测试：全仓库 tests、protocol/client acceptance、build plugins、package/preflight/smoke。

- [ ] **步骤 1：运行禁止残留检查**

运行下列命令，并将命中按“必须修复”或“允许数据/历史路径”分类：

```cmd
git grep -n "@innocencecode/" -- .
git grep -n "innocencecode://" -- .
git grep -n "innocence-plugin://" -- .
git grep -n "INNOCENCE_TEST_" -- .
git grep -n "InnocenceCode_SMOKE_OUT" -- .
git grep -n "InnocenceCode-win32-x64\|InnocenceCode.exe\|InnocenceCodeSetup.exe" -- .
```

预期：运行时 source、package metadata、scripts、tests 和 fixtures 无旧入口。仅允许 `.innocence`/`~/.innocence` 用户数据路径和 Git remote/history 说明；它们不得被 resolver、protocol 或 build script 当作旧协议兼容入口。

- [ ] **步骤 2：运行完整 build/type/test 验收**

```cmd
npm install
npm run typecheck
npm run typecheck:packages
npm test
npm run build:plugins
```

预期：全部退出码 0。任何资源敏感 Windows 失败必须分离重现、记录根因并修复或报告为阻塞，不能用 skip 或更宽松断言掩盖。

- [ ] **步骤 3：运行真实 Electron/协议验收**

```cmd
npx vitest run src/main/protocol.test.ts src/webview/src/pluginClient/loader.test.tsx src/webview/src/state/usePluginClients.test.tsx tests/external-ui.acceptance.test.ts
```

预期：新 app/plugin scheme、revision URL、真实 panel/settings 显示与停用撤销通过；旧 schemes 不可加载。

- [ ] **步骤 4：运行新 Forge 产物验收**

```cmd
npm run package:preflight
npm run package
npm run package:smoke
```

预期：

- Forge 生成 `out/InnocenceHarness-win32-x64/InnocenceHarness.exe`。
- required smoke 返回 0。
- 输出包含 `PKG_SMOKE pty ok`、`PKG_SMOKE task ok`、`PKG_SMOKE lockfiles 0`、`PKG_SMOKE done`。
- lock/process residue sweeps 为空。

- [ ] **步骤 5：最终工作树检查与提交**

运行：

```cmd
git status --short
git diff --check
git log --oneline --decorate -12
```

确认不包含 `out`、`build`、`.vite`、临时 acceptance root 或用户数据目录；保留用户已有不相关改动。

提交：

```cmd
git add package.json package-lock.json packages vendor scripts src tests forge.config.ts README.md AGENTS.md
git commit -m "chore(rename): complete InnocenceHarness migration"
```

---

## 规格覆盖自检

- 规格第 1–3 节目标/兼容边界/映射：任务 1、2、3、4、5 逐项迁移，任务 6 禁止残留验证。
- 规格第 4 节包作用域：任务 1 覆盖 metadata、import、declaration、lockfile、staging 和 resolver。
- 规格第 5 节协议：任务 2 覆盖主/插件 scheme、CSP、dynamic import、query 和旧 scheme 拒绝。
- 规格第 6 节环境变量：任务 3 覆盖 controlled marker、packaged gate、fixture launcher 和旧变量失效。
- 规格第 7 节 Forge/staging：任务 1、4 覆盖 new namespace staging、Forge product/output、preflight、smoke 和 native prune。
- 规格第 8 节 UI：任务 5 覆盖 UI、menu、locale、README、system prompts 和 package descriptions。
- 规格第 9 节错误策略：任务 1–4 的 failing tests 与 task 6 的 actual exit-code verification 覆盖 fail-closed 行为。
- 规格第 10–12 节测试矩阵、残留检查和完成定义：任务 6 覆盖 Node/jsdom/real Electron/workspace/Forge 和 final gates。

接口命名一致：`APP_SCHEME`、`PLUGIN_SCHEME`、`clientModuleUrl`、`resolveTestOverrides`、`inspectPackagedSmoke`、`runPackageSmoke`、`cleanPackageOutput`。任何实现发现既有接口已经承担同一职责时，应保留既有命名而非建立并行入口。
