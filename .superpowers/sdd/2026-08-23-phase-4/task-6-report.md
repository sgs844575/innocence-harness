# 阶段 4 统一修复最终报告（任务 6）

日期：2026-08-24
分支：`phase4-development`
基线：`98164cd`
最终实现提交：`98164cd` (`fix(phase4): complete final review gates`)
HMR cache-busting 提交：`aa800fe` (`fix(plugin-client): cache-bust HMR client reload`)
状态：`DONE_WITH_CONCERNS`。实现和定向复审均 clean，但阶段完成所需的真实 Forge package、packaged markers 以及最新全量测试尚未达到无条件通过。

## 修复范围

### 1. 测试环境 override 生产隔离

- 新增集中 gate：`src/main/testOverrides.ts`。
- 普通开发启动也必须有 `INNOCENCE_TEST_MODE=1` 才读取测试路径；packaged 启动除 marker 外还必须带 `--innocence-controlled-test`。
- `src/main/index.ts`、`src/main/harnessGlue.ts`、`defaultUserPluginRoot()` 不再直接读取测试环境变量。
- `tests/external-ui.acceptance.test.ts` 的开发 launcher 设置 `INNOCENCE_TEST_MODE=1`；packaged launcher 带 `--innocence-controlled-test`。
- 补充 packaged 无 marker、packaged marker+argument、dev marker、dev 无 marker 测试。

### 2. HMR 真实开发 boot 接线

- 从 manifest `client: true` 条目派生 user/builtin 两套 `<root>/<id>/dist/client.js` target。
- 开发 boot 创建 watcher；生产或 packaged boot 不创建 watcher。
- watcher setup、单个 client refresh 失败均记录并继续，不阻断 boot。
- main 通过 `plugins:changed` typed IPC 事件通知 renderer；renderer 的 `usePluginClients` 订阅后在 HMR 回调中先递增 revision，再刷新 inventory 并调用 `loadPluginClients()`，没有 host 直接操作 React state。
- 使用 `Promise.resolve` 收敛 callback 类型，修复原 `void | Promise<void>` TypeScript 错误。
- fake watcher、真实 Node watcher、target/callback/dispose 相关测试均覆盖。

### 3. package smoke required gate

- `package:smoke` 改为执行 `scripts/packaging/runPackageSmoke.ts`。
- runner 先检查 executable、archive、`.vite/build/smoke.js`；缺少任一产物打印明确诊断并返回 2。
- 有产物才启动 `tests/packaged-exit.acceptance.test.ts`；普通 `npm test` 仍保留 packaged-exit 的明确 skip 行为。
- 补充 runner 缺产物非零退出测试。

### 4. HMR client module cache busting

- `loadPluginClients` 保持首次加载 URL `innocence-plugin://<id>/dist/client.js` 不变；可选 `revision` 仅在 HMR 重载时附加 `?hmr=<revision>`。
- `usePluginClients` 在 `plugins:changed` 回调中先递增 revision，再刷新 inventory；普通设置/清单刷新不附加 cache-busting query。
- `handlePluginScheme` 继续仅按 URL pathname 解析文件路径，query 不改变所读取的插件文件。
- 回归测试覆盖不同 HMR import URL、新 client module 注册内容替换旧内容，以及 protocol query path 行为。

## 验证记录

### 实现与定向复审（clean）

- HMR cache-busting 定向复审：`npm test -- --run src/webview/src/pluginClient/loader.test.tsx src/webview/src/pluginClient/api.test.tsx src/webview/src/state/usePluginClients.test.tsx src/webview/src/lib/ipc.test.ts src/main/ipc.skillDiscovery.test.ts src/main/protocol.test.ts src/main/pluginBoot/hmrWiring.test.ts`：7 files passed，50 tests passed。
- 真实开发 Electron 验收：`npm test -- --run tests/external-ui.acceptance.test.ts`：1 file passed，3 tests passed。
- 既有关键定向 acceptance/integration：8 files passed，48 tests passed；packaged-exit 的 2 个测试因缺 executable 明确 skip。
- 资源敏感用例提高超时后的独立重跑：4 files passed，55 tests passed。
- `npm run typecheck`：退出 0。
- `npm run typecheck:packages`：退出 0。
- `git diff --check`：通过；提交后工作树 clean。

### 最新独立验证

- `npm test`：退出 1；**不能称全量通过**。结果为 165 files passed、4 files failed、1 file skipped；1350 passed、5 failed、4 skipped。
  - 失败为资源敏感用例：`packages/tools-shell/tests/shell.test.ts` 的 oversized output 超时；`src/main/taskRuntimeBridge.test.ts` 的 lifecycle 资源释放超时；`packages/task-cli/tests/cli-integration.test.ts` 的跨进程锁竞争失败/超时。
  - 这些失败与本次实现路径无直接重叠，但它们是最新全量套件的真实失败，未被忽略或改写为成功。
- `npm run typecheck`：退出 0。
- `npm run typecheck:packages`：退出 0。
- `npm run package:preflight`：退出 2；现有 `out\InnocenceCode-win32-x64\resources\app.asar` 被外部进程占用，有限重试后仍为 `EBUSY`。
- `npm run package`：退出 2；在 `prepackage -> package:preflight` 阶段因相同 `EBUSY` 停止，Forge 未运行。
- `npm run package:smoke`：退出 2；required gate 正确报告 packaged executable 缺失，未把 skip 伪报为成功。
- 工作树 clean，`git diff --check` clean。

## 最终账本状态

- 实现与定向复审：clean。
- 阶段完成定义要求的真实 Forge package 和 packaged markers：仍被外部 `app.asar` `EBUSY` 锁及缺少 packaged executable 阻塞。
- 最新 `npm test` 全量套件：仍有资源敏感失败；不得将阶段标为无条件完成。

## 结论

三项 Important 的实现已提交：生产默认路径保留 app userData/resources/plugins；测试 override 仅在显式受控 marker 下启用；开发 HMR 已从 manifest 到 watcher、IPC、renderer loader 完整接线并通过 cache-busting 防止旧 client module 缓存；package smoke 已成为 required gate。阶段状态保持 `DONE_WITH_CONCERNS`，直至外部 package 锁解除、可生成 packaged executable 并运行真实 packaged markers，且最新全量测试不再失败。
