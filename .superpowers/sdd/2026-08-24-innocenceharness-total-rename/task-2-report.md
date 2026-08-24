# 任务 2 报告：主应用与插件协议迁移

- 状态：通过（第 1 轮修复）
- 基础提交：`b489546 refactor(protocol): migrate application and plugin schemes`
- 修复提交：`403fc18 fix(protocol): harden scheme origins and package paths`
- 工作树：`D:\Projects\AiProjects\InnocenceHarness-rename`

## 第 1 轮修复

- `appWindow.ts` 导航白名单改为解析 URL：应用 URL 必须满足 protocol `innocenceharness:` 且 hostname `app`；开发服务器使用解析后的 origin 严格比较，不再使用 `startsWith`。
- app scheme handler 同样校验 protocol 与 hostname，拒绝 `app.evil`、`app@evil`、旧 scheme 和 malformed URL。
- packaged 默认路径统一为 `out/InnocenceHarness-win32-x64/InnocenceHarness.exe`：修复 packaged-exit acceptance、availability fixture 与 `tools/smoke-test.cjs`。旧产物名不再作为默认目标。
- `harnessGlue.ts` 继续使用任务 1 已建立的 `@innocenceharness` staging namespace 动态路径；这是跨任务依赖，不是为本轮新增 alias，也未修改 package scope 或用户数据路径。

## 验证

- 红灯：新增 host/origin 测试在修复前失败；protocol 测试最初因测试插入位置语法错误，修正测试结构后按预期失败。
- 定向测试：
  ```text
  npx vitest run src/main/protocol.test.ts src/main/appWindow.test.ts tests/packaged-exit.availability.test.ts tests/external-ui.acceptance.test.ts
  4 files passed; 42 tests passed
  ```
- typecheck：`npm run typecheck` 通过。
- package typecheck：`npm run typecheck:packages` 通过。
- package：因既有 `out/InnocenceHarness-win32-x64/resources/app.asar` 被锁定，`npm run package` 被 package preflight 拒绝；重试并确认无残留 `InnocenceHarness.exe` 进程后仍为 `EBUSY`。这是环境/文件锁阻塞，不是编译错误。
- 路径 grep：`tests`、`tools`、`scripts` 中不再有 `InnocenceCode-win32-x64` 或 `InnocenceCode.exe` 默认路径。
- `tools/smoke-test.cjs` 通过 `node --check`。

## 疑虑

- package 最终重打包无法完成，因为已有输出目录中的 `resources/app.asar` 被外部进程或系统句柄锁定；本轮未强制删除或绕过 preflight。
- 全量测试曾出现与协议无关的 Windows 临时文件锁/并发不稳定失败；本轮要求的定向测试全部通过。
