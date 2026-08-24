# 任务 4 报告：迁移 InnocenceHarness 打包产物

## 工作区与提交

- Worktree：`D:\Projects\AiProjects\InnocenceHarness-rename`
- Branch：`innocenceharness-total-rename`
- 起始 HEAD：`83687ae1abbd522a3fbedf16032d3ea515abe2c2`
- Commit：`82ec888` (`chore(packaging): migrate InnocenceHarness artifacts`)

## 实现结果

- `forge.config.ts`
  - executable：`InnocenceHarness`
  - setup：`InnocenceHarnessSetup.exe`
  - maker name：`InnocenceHarness`
  - 导出统一的 `packagingArtifactNames`，测试覆盖实际 Forge 配置源。
- 默认 package 路径：
  - `D:\Projects\AiProjects\InnocenceHarness-rename\out\InnocenceHarness-win32-x64`
  - executable：`InnocenceHarness.exe`
- `outPreflight` allowlist 只接受 `InnocenceHarness-<platform>-<arch>`，旧 `InnocenceCode-win32-x64` 被拒绝。
- packaged availability、required package smoke、packaged-exit acceptance 使用新目录和 executable。
- staging self-check 继续使用 `@innocenceharness` scope；`npm run build:plugins` 成功。
- package smoke required gate 保持：缺失 executable/archive/smoke entry 返回非零；EBUSY 只做有限重试并报告 cause，不强杀未知进程。

## 验证与真实退出码

| 命令 | 退出码 | 结果 |
|---|---:|---|
| 定向 packaging/packaged-exit tests | 0 | 4 个测试文件通过，29 passed，2 skipped（无新 package executable） |
| `npm run build:plugins` | 0 | staging assembled，scope self-check 通过 |
| `npm run typecheck` | 0 | 通过 |
| `npm run typecheck:packages` | 0 | 所有 workspace package 通过 |
| `npm run package:preflight` | 2 | 新路径 `out\InnocenceHarness-win32-x64` 的 `resources\app.asar` 真实 EBUSY；输出包含 code=EBUSY、attempts=3、bounded retry 和 cause，未强杀进程 |
| `npm run package` | 2 | `prepackage` 在同一真实 EBUSY preflight gate 停止，未误报 package 成功 |
| `npm run package:smoke` | 2 | 新 executable 缺失，required smoke 硬失败 |
| retired `IC_PACKAGE_DIR=...\out\InnocenceCode-win32-x64 npm run package:smoke` | 2 | 旧 package 目录被 allowlist 拒绝 |
| `npm test` | 1 | 169 files passed、1374 tests passed；3 个与本任务无关的 Windows 临时目录 EBUSY/超时失败：`packages/tools-shell/tests/shell.test.ts` 1 项 EBUSY/超时，`src/main/taskRuntimeBridge.test.ts` 2 项超时 |

## 新路径与旧路径残留

新目标路径：

- `out/InnocenceHarness-win32-x64/InnocenceHarness.exe`
- `out/InnocenceHarness-win32-x64/resources/app.asar`
- `InnocenceHarnessSetup.exe`

旧 artifact 目标残留：

- 活动实现中无 `InnocenceCode.exe`、`InnocenceCodeSetup.exe` 或 `out/InnocenceCode-*` 目标。
- 旧名只保留在 `scripts/packaging/outPreflight.test.ts` 的负断言中，用于证明旧目标被拒绝。
- 本报告不把历史 brief/plan 中的旧名视为活动目标残留。

## package / lock 疑虑

`out/InnocenceHarness-win32-x64/resources/app.asar` 被现有进程锁定。preflight 三次 bounded retry 均返回 EBUSY，并保留原始 cause；实现没有扩大删除范围，也没有终止未知进程。必须释放拥有该文件锁的进程后再次运行 `npm run package:preflight`、`npm run package` 和 `npm run package:smoke`，才能完成真实 packaged-exit smoke。

## 结论

代码迁移和定向验收通过；最终 package/required smoke 受现有 package 输出锁和缺失新 executable 阻塞。全量测试另有独立 Windows 临时资源竞争失败，未修改其无关代码。
