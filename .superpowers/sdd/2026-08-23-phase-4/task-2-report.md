# 阶段 4 任务 2 报告

## 简报验证

- 已确认唯一需求文件非空：`D:\Projects\AiProjects\InnocenceCode-phase4\.superpowers\sdd\2026-08-23-phase-4\task-2-brief.md`。
- 文件共约 119 行，首标题为 `## 任务 2：接入真实 HMR watcher/restart`。
- 工作分支为 `phase4-development`，起始 HEAD 为 `9b53bba`，未修改技能导入文件。
- 提交前工作树干净；提交后工作树仍干净。

## 修改文件

- `D:\Projects\AiProjects\InnocenceCode-phase4\vendor\kernel-hmr\tests\hmr.spec.ts`
  - 扩展 restart 失败后仍保留注册的断言，确认失败后可再次尝试。
- `D:\Projects\AiProjects\InnocenceCode-phase4\src\main\pluginBoot\hmrWatcher.ts`
  - 新增基于真实 Node `fs.watch` 的宿主 HMR watcher。
  - 支持事件去抖、同一 id 单 active registration、restart 串行化、失败记录后保留注册、幂等 disposer 和全局 dispose。
  - watcher 启动失败时关闭已打开资源并抛出带 `cause` 的错误。
- `D:\Projects\AiProjects\InnocenceCode-phase4\src\main\pluginBoot\hmrWatcher.test.ts`
  - 覆盖连续事件合并、串行 restart、失败重试、启动失败不污染注册、幂等清理和真实文件变更。
- `D:\Projects\AiProjects\InnocenceCode-phase4\src\main\pluginBoot\compose.ts`
  - 增加显式开发模式 HMR watcher factory 接口和 `watchPlugin` 接线点。
  - 生产模式不创建 watcher。
  - boot dispose 先 dispose watcher，再 dispose root fiber。
- `D:\Projects\AiProjects\InnocenceCode-phase4\src\main\pluginBoot.integration.test.ts`
  - 增加真实 staging boot 的文件变更、dispose 后无回调和生产模式不创建 watcher 覆盖。

## 测试与输出

定向命令：

```cmd
npx vitest run vendor/kernel-hmr/tests/hmr.spec.ts src/main/pluginBoot/hmrWatcher.test.ts src/main/pluginBoot.integration.test.ts
```

结果：

- Test Files：3 passed
- Tests：23 passed
- 包含 kernel HMR 4 项、host watcher 5 项、pluginBoot integration 14 项

TDD 红灯验证：

- 首次运行新增 watcher 测试时失败，原因为 `Cannot find module './hmrWatcher'`。
- 该失败对应新增接口缺失，随后完成最小实现并转绿。

## Typecheck

命令：

```cmd
npm run typecheck
```

结果：通过，无 TypeScript 错误输出。

另已运行 `git diff --check` 和暂存区 diff 检查，未发现空白错误。

## Commit

```text
d4d93ca feat(HMR): 接入真实 watcher 与串行重启
```

## 审查修复记录

### 修复内容

- `src/main/pluginBoot/hmrWatcher.ts`
  - 为每个 FSWatcher 注册异步 `error` listener，记录 id/path/error，清理 timer、registration 和 watcher；清理失败也转为诊断日志，不产生未捕获异常。
  - 增加按 id 的 replacement queue，串行化并发 `watchPath` 替换，避免旧/新 watcher 交错和泄漏。
  - registration 追踪当前 restart Promise；disposer 先阻止新事件、清 timer、关闭 watcher，再等待 in-flight restart；全局 dispose 等待 replacement queue 和全部 registration。
- `src/main/pluginBoot/compose.ts`
  - watcher dispose 使用 try/finally，确保 watcher 清理失败时 root fiber 仍然 teardown，并继续保留 watcher 错误诊断/拒绝结果。
- `src/main/pluginBoot/hmrWatcher.test.ts`
  - 新增异步 watcher error、同 id 并发替换全量清理、in-flight restart 等待测试。
- `src/main/pluginBoot.integration.test.ts`
  - 新增 watcher dispose rejection 后 root fiber 仍被清理的集成测试。

### 修复验证

TDD 红灯：

```cmd
npx vitest run vendor/kernel-hmr/tests/hmr.spec.ts src/main/pluginBoot/hmrWatcher.test.ts src/main/pluginBoot.integration.test.ts
```

修复前新增测试失败 3 项：

- watcher 异步 error 未清理 registration；
- in-flight restart dispose 未等待；
- watcher dispose rejection 阻断 root teardown。

并发替换测试在修复前未能暴露泄漏，修复后断言最终打开 2 个 watcher 且全局 dispose 关闭 2 个 watcher。

修复后结果：

- Test Files：3 passed
- Tests：27 passed
- `npm run typecheck`：通过，无 TypeScript 错误输出
- `git diff --check`：通过

### 修复提交

```text
2fa8eb9 fix(HMR): 修复 watcher 生命周期竞态
```

### 本轮修复记录（第 2 轮）

- `src/main/pluginBoot/hmrWatcher.ts`
  - 增加 `pendingDisposals` tracked promise 集合。
  - FSWatcher 异步 error handler 将 `disposeRegistration()` promise 加入集合，并在 finally 移除。
  - global `dispose()` 在等待 replacement queue 和当前 registration 后，继续等待所有 error-triggered disposal/restart promise，避免 registration 已删除但 in-flight restart 未完成时提前返回。
- `src/main/pluginBoot/hmrWatcher.test.ts`
  - 增加并发 watcher error + global dispose 测试，确认 global dispose 会等待 error-triggered restart 完成后才返回。

本轮 TDD 红灯：新增测试在修复前失败，`dispose()` 在 restart release 前已 settled；失败原因正是 error handler 启动的 disposal 不在 global dispose 可等待集合内。

本轮验证：

```cmd
npx vitest run vendor/kernel-hmr/tests/hmr.spec.ts src/main/pluginBoot/hmrWatcher.test.ts src/main/pluginBoot.integration.test.ts
npm run typecheck
```

结果：定向测试 28 项通过，`npm run typecheck` 通过。

### 本轮修复提交

```text
f240c65 fix(HMR): 跟踪异步 watcher 清理
```

### 修复疑虑

- 保持 `vendor/kernel-hmr` 仅负责注册/restart/stop/fiber 生命周期；真实 fs watcher 仍只位于 host `src/main/pluginBoot/hmrWatcher.ts`。
- 保持生产模式显式开关不变：只有 `enableHmrWatcher === true` 且 `NODE_ENV !== "production"` 才创建 watcher。
