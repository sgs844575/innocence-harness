# 任务 3 报告：真实 Electron 外部 panel/settings 宿主验收

日期：2026-08-24
分支：`phase4-development`
基线提交：`229410d test(UI): 增加外部 panel 与 settings 宿主验收`
跟进：审查修复待提交

## 接管的未提交改动

接管时 HEAD 为 `6fdcf11`，工作树已有以下未提交改动，未盲目恢复：

- `src/main/harnessGlue.ts`
- `src/main/index.ts`
- `src/main/pluginBoot/compose.ts`
- `src/webview/src/pluginClient/loader.test.tsx`
- `tests/external-ui.acceptance.test.ts`
- `tests/fixtures/external-ui-plugin/*`

初次交付后审查要求修复 `tests/external-ui.acceptance.test.ts` 的 runtime 探测、packaged 分支、启动诊断与 finally 清理边界。本次 follow-up 仅修改 acceptance harness，不改变生产默认路径、真实 panel/settings 行为或三个 `INNOCENCE_TEST_*` 生产测试 override。

## 本次审查修复

1. **runtime 缺失改为惰性诊断 skip**
   - 不再在 module collect 阶段无保护地调用 `require.resolve("electron/package.json")`。
   - 开发 Electron binary 和 packaged executable 均使用安全探测；缺失、消失或不可读时返回明确原因。
   - 图形环境或 runtime 缺失时使用条件 `it.skip` 并输出 `[external-ui] SKIP: ...`。
   - fixture、staging、路径、构建或应用启动失败仍在测试体中抛错，不会被 skip 吞掉。

2. **packaged 分支不依赖 `.vite`**
   - 仅当 `runtime.packaged === false` 时检查 `.vite/build/main.js` 并把它作为 Electron app path 参数。
   - packaged runtime 分支不检查或传入 dev `mainEntry`。

3. **启动诊断完整**
   - `launchApp` 先绑定 child stdout/stderr，再等待 `/json/list`、page target 和 DevTools websocket。
   - 任一启动等待、page target 或 DevTools 连接错误都会把已收集的 stdout/stderr 附在错误中。
   - 测试体内后续 DOM 失败同样附带当前收集输出。

4. **局部 finally 完整清理**
   - 测试体创建 `LaunchState` 与三个 temp roots 后进入完整 `try/finally`。
   - finally 关闭 DevTools socket、终止 Electron child，并递归删除 user plugin root、builtin root、userData。
   - `afterEach` 保留为兜底，不再是唯一清理路径。

## 针对性 skip 证据

使用明确测试环境变量模拟 runtime 不可用：

```cmd
set INNOCENCE_TEST_EXTERNAL_UI_DISABLE_RUNTIME=1
npx vitest run tests/external-ui.acceptance.test.ts
```

实际输出：

```text
[external-ui] SKIP: desktop runtime unavailable: Electron development binary or packaged executable not found (D:\Projects\AiProjects\InnocenceCode-phase4\out\InnocenceCode-win32-x64\InnocenceCode.exe)
Test Files 1 skipped (1)
Tests 1 skipped (1)
```

该命令在 module collect 阶段未失败，且测试体未执行。真实 runtime 可用时没有 skip。

## Fixture 与真实 Electron 结果

fixture 仍保持零 import、自包含，仅消费宿主注入的 panel/settings API：

- `fixture-panel` / `Fixture panel content`
- `fixture-settings` / `Fixture settings content`

真实 Electron acceptance 仍使用真实 BrowserWindow、preload、App、slot registry、`innocence-plugin://` handler 和 DevTools websocket。最近一次真实运行：

```text
✓ tests/external-ui.acceptance.test.ts (1 test) 965ms
Test Files 1 passed (1)
Tests 1 passed (1)
```

真实 DOM 验证 panel/settings 出现；在插件设置页关闭 fixture 后，panel 与 settings 两类贡献均撤销。

## 最终验证

```text
npm run typecheck              PASS
npm run typecheck:packages     PASS

快速 UI：
Test Files 3 passed (3)
Tests 34 passed (34)

真实 Electron：
Test Files 1 passed (1)
Tests 1 passed (1)

runtime 缺失诊断：
Test Files 1 skipped (1)
Tests 1 skipped (1)
```

## 清理

- 局部 `finally` 关闭 DevTools socket。
- 局部 `finally` 通过 Windows `taskkill /T /F` 终止 Electron child。
- 局部 `finally` 删除三个临时根；afterEach 继续兜底。
- 最近验证无 `ic-external-ui-*` 临时根和 Electron 子进程残留。
- 未修改用户插件目录、用户配置目录或其他用户路径。

## 历史环境疑虑

此前 `npm run package` 的 prePackage、plugin staging、main/preload/renderer Vite 构建均通过，但 Forge 覆盖既有 `out/InnocenceCode-win32-x64/resources/app.asar` 时遇到 Windows `EBUSY`。该疑虑不影响本次 `.vite` 开发 runtime 的真实 acceptance；未强杀用户宿主进程，原诊断保留在基线报告中。

## 结论

审查指出的四个 harness 问题均已修复并验证。真实 runtime 路径通过；runtime 缺失路径显式 skip 且输出实际诊断；工作树待本 follow-up commit 后确认干净。
