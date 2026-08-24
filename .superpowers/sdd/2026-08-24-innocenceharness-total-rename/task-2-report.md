# 任务 2 报告：主应用与插件协议迁移

- 状态：通过（第 2 轮修复）
- 基础提交：`b489546 refactor(protocol): migrate application and plugin schemes`
- 第 1 轮修复提交：`0706260 fix(protocol): harden scheme origins and package paths`
- 第 2 轮修复提交：`867587f fix(smoke): align harness handshake naming`
- 工作树：`D:\Projects\AiProjects\InnocenceHarness-rename`

## 第 1 轮修复

- `appWindow.ts` 导航白名单改为解析 URL：应用 URL 必须满足 protocol `innocenceharness:` 且 hostname `app`；开发服务器使用解析后的 origin 严格比较，不再使用 `startsWith`。
- app scheme handler 同样校验 protocol 与 hostname，拒绝 `app.evil`、`app@evil`、旧 scheme 和 malformed URL。
- packaged 默认路径统一为 `out/InnocenceHarness-win32-x64/InnocenceHarness.exe`：修复 packaged-exit acceptance、availability fixture 与 `tools/smoke-test.cjs`。旧产物名不再作为默认目标。
- `harnessGlue.ts` 继续使用任务 1 已建立的 `@innocenceharness` staging namespace 动态路径；这是跨任务依赖，不是为本轮新增 alias，也未修改 package scope 或用户数据路径。

## 第 2 轮修复

- `src/main/appWindow.ts` 与 `tools/smoke-test.cjs` 的活动 smoke 握手统一为 `InnocenceHarness_SMOKE_OUT`。
- `tools/smoke-test.cjs` marker/temp 前缀统一为 `innocenceharness-smoke-*`。
- 新增 smoke 命名测试，确认旧环境变量与旧 marker 前缀不再出现在活动脚本中。
- 未修改协议、严格 host/origin 校验、包作用域、用户数据路径或任务 1 staging namespace。

## 验证

- 红灯：新增 smoke 命名断言在修复前失败；旧脚本仍使用 `InnocenceCode_SMOKE_OUT` 与 `innocencecode-smoke-*`。
- 定向测试：
  ```text
  node --check tools/smoke-test.cjs
  npx vitest run tools/smoke-test.test.ts scripts/packaging/runPackageSmoke.test.ts src/main/protocol.test.ts src/main/appWindow.test.ts tests/external-ui.acceptance.test.ts
  5 files passed; 39 tests passed; 1 acceptance test skipped because no packaged executable was available
  ```
- typecheck：`npm run typecheck` 通过。
- smoke/protocol/appWindow/acceptance 定向验证通过；external UI acceptance 在本轮因 package 输出被锁定后不存在可用 executable，按测试既有规则明确 skip。
- 第 1 轮已验证 `npm run typecheck:packages` 通过；本轮仅触及 appWindow/smoke naming，无 package 类型边界变化。
- 第 1 轮 package 仍受 `out/InnocenceHarness-win32-x64/resources/app.asar` 文件锁阻塞；本轮未强制删除或绕过 preflight。
- 活动代码 grep：`src/main/appWindow.ts` 与 `tools/smoke-test.cjs` 仅使用 `InnocenceHarness_SMOKE_OUT` 和 `innocenceharness-smoke-*`；旧名称只出现在测试中的负断言。

## 疑虑

- 第 1 轮报告中的错误提交 hash `403fc18` 已更正为实际修复提交 `0706260`。
- package 输出目录的 `resources/app.asar` 文件锁仍是环境阻塞，不是本轮代码或类型错误。
