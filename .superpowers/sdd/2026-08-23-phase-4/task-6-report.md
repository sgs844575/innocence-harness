# 阶段 4 统一修复最终报告（任务 6）

日期：2026-08-24  
分支：`phase4-development`  
基线：`98164cd`
状态：`DONE_WITH_CONCERNS`（三项 Important 已完成；完整 `npm test` 在并发资源敏感用例上出现既有环境抖动，定向重跑通过）

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

### 通过

- `npm test -- --run src/webview/src/pluginClient/loader.test.tsx src/webview/src/pluginClient/api.test.tsx src/webview/src/state/usePluginClients.test.tsx src/webview/src/lib/ipc.test.ts src/main/ipc.skillDiscovery.test.ts src/main/protocol.test.ts src/main/pluginBoot/hmrWiring.test.ts`：7 files passed，50 tests passed。
- `npm test -- --run tests/external-ui.acceptance.test.ts`：1 file passed，3 tests passed。
- `npm run typecheck`：通过。
- `npm run typecheck:packages`：通过。
- `git diff --check`：通过。
- 既有关键定向 acceptance/integration：8 files passed，48 tests passed，packaged-exit 2 tests因缺 executable明确 skip。
- 既有 `npm test -- --run packages/tools-shell/tests/shell.test.ts src/main/codeReader.test.ts src/main/taskRuntimeBridge.test.ts packages/task-cli/tests/cli-integration.test.ts --testTimeout=15000`：4 files passed，55 tests passed。
- 既有 renderer 插件相关：2 files passed，16 tests passed。
- `npm run typecheck`：通过。
- `npm run typecheck:packages`：通过。
- `git diff --check`：通过。
- `npm run package:smoke`：按 required gate 返回 2；诊断为 packaged executable 缺失：`D:\Projects\AiProjects\InnocenceCode-phase4\out\InnocenceCode-win32-x64\InnocenceCode.exe`。

### 有限失败/阻塞

- `npm run package:preflight`：返回 2。现有 `out\InnocenceCode-win32-x64\resources\app.asar` 被占用，输出 `EBUSY`，有限重试 3 次后真实失败；未强杀未知进程。
- `npm run package`：返回 2，在 `prepackage -> package:preflight` 阶段停止，Forge 未运行；原因同上。
- `npm test`：165 files passed、4 files failed、1 file skipped（1350 passed、5 failed、4 skipped）。失败均为既有并发资源敏感用例：临时目录 `EBUSY/ENOTEMPTY` 及 shell/codeReader/taskRuntimeBridge/task-cli 超时；本次修改相关的 7-file 定向集、external UI acceptance 与类型检查均通过。
- 因 package 输出锁定且 executable 缺失，无法运行真实 packaged markers；required runner 已证明缺产物时非零失败。

## 结论

三项 Important 的实现与定向验证完成。生产默认路径保持 app userData/resources/plugins；测试 override 需显式受控标记。开发 HMR 已从 manifest 到 watcher、IPC、renderer loader 完整接线。package smoke 已成为真正 required gate。

提交：`98164cd` (`fix(phase4): complete final review gates`)；本次新增提交另行记录。
