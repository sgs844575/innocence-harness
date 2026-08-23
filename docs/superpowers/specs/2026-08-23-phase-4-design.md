# 阶段 4 设计规格：安全复制、真实重载、宿主验收与打包收尾

> 日期：2026-08-23
>
> 范围：技能递归复制的完整 TOCTOU 防护、HMR 真实 watcher/restart、外部 UI panel/settings 端到端测试、`allowStaticSpine` 测试专用化、清理 `out` 锁并完成最终 Forge package 验证。

## 1. 背景与目标

阶段 3 已完成插件内核服务、动态 spine、双根插件加载、UI 槽位和基础插件 client 链路。本阶段不重写这些边界，而是补齐从安全细节到真实宿主验收之间的缺口：

1. 技能导入的安全判断必须覆盖整个递归复制过程，而不只覆盖复制入口。
2. HMR（Hot Module Replacement，热模块重载）必须接入真实文件 watcher 和 restart 回调，而不只提供内核内存注册表。
3. 外部 panel 和 settings section 必须通过真实桌面宿主链路完成一次端到端验收。
4. 静态 spine 只能作为测试或自含 fixture 的显式能力，不能继续成为普通运行时的隐式回退。
5. `out` 目录的残留锁和历史产物必须安全收敛，最终 Forge package 需要有可重复的资源与退出验证。

## 2. 非目标与边界

本阶段不包含以下工作：

- 不新增插件 marketplace、网络下载或远程代码执行能力。
- 不把文件系统 watcher 逻辑下沉到 vendor kernel 框架层；框架层只维护注册、重启和生命周期。
- 不替换现有 `innocence-plugin://` 协议、slot registry、插件清单投影或内置 UI 贡献模型。
- 不放宽现有插件来源双根约束，也不改变用户根优先、内置 staging 根回落的顺序。
- 不通过删除用户 Git index、工作区文件或未知进程来解决打包锁问题。
- 不以 Electron-specific 类型污染 domain、protocol、provider 或 capability package；真实桌面宿主测试属于 host acceptance 层。

## 3. 总体架构

阶段 4 采用「框架服务 + 宿主适配器 + 测试夹具」三层结构：

```text
技能导入安全层
  └─ discover/import → canonical root guard → recursive safe copy → atomic publish

HMR 框架层
  └─ kernel-hmr registry/effect lifecycle
       └─ host watcher adapter（开发模式）
            └─ fs.watch → debounce → serialized restart

外部 UI 验收层
  └─ plugin client fixture → innocence-plugin:// → preload bridge → renderer App
       └─ panel/settings slots → visible contribution → disable/reload withdrawal

运行时 spine 策略
  └─ production boot: injected dynamic spine only
  └─ tests/fixtures: explicit test helper may opt into static suite

打包收尾
  └─ out preflight/lock diagnosis → Forge package → package smoke → artifact assertions
```

所有新增可复用逻辑仍按仓库规则放入 `packages/*` 或明确的 host adapter；测试只通过 typed ports、fake watcher、临时目录和 fixture plugin 注入依赖。

## 4. 技能递归复制的 TOCTOU 防护

### 4.1 安全不变量

`importSkill` 必须同时满足以下不变量：

- `sourceDir` 在导入开始时是已知外部根下的真实目录，且不是符号链接。
- 递归过程中不得跟随任何符号链接；目录链接和文件链接都跳过或拒绝，不能复制链接指向的内容。
- 每次进入目录、复制条目和提交目标前，都重新检查路径身份和类型；此前的 `lstat` 或 `realpath` 结果不得被视为永久授权。
- 所有 canonical source path 必须继续位于导入开始时确认的已知根内。
- 复制失败必须删除临时目标，不得留下可被下一次导入误认为完整技能的半成品。
- 只有完整复制并完成目标校验后，才允许将临时目录原子 rename 为最终技能目录。

### 4.2 复制流程

1. 校验 frontmatter 得到的技能名，拒绝分隔符、点前缀和驱动器前缀。
2. 解析已知外部根的 `realpath`，验证入口 `sourceDir` 的 `lstat`、目录类型、非链接属性和 canonical containment。
3. 选择目标名称，并在用户技能根下创建唯一临时目录；临时目录名不得来自不可信路径片段。
4. 递归复制：
   - 进入目录前对源路径重新 `lstat` 和 `realpath`。
   - 枚举后对每个条目重新 `lstat`；链接条目跳过，目录和普通文件按当前类型处理。
   - 目录递归前再次确认 canonical path 仍在已知根内，并防止重复目录身份造成环。
   - 文件复制前后分别检查源和目标类型；目标不得为符号链接。
5. 复制完成后重新检查入口源和临时目标，确认源未在过程末尾变成链接或根外路径，目标目录只包含允许复制的实体。
6. 使用同一文件系统上的 rename 将临时目录提交为最终名称；目标竞争或提交失败时清理临时目录并向调用方返回明确错误。

实现可以继续使用 Node `fs/promises`，但递归函数需要接收可测试的文件系统端口或等价的内部注入点，以便测试在校验与复制之间模拟替换，不依赖不稳定的真实竞态窗口。

### 4.3 错误处理

- 来源消失、类型变化、canonical path 越界：统一返回「技能来源不在已知根内」语义的错误，不泄露外部路径细节。
- 目标创建、复制或 rename 失败：保留原始错误作为 `cause`，同时保证临时目录清理尽力完成。
- 清理本身失败：记录诊断信息，但不得把清理失败伪装成导入成功。
- 发现重复名称时沿用现有 `-imported`、`-imported-2` 规则；名称探测和最终提交都必须重新处理竞争。

### 4.4 测试验收

新增或扩展 `src/main/skillDiscovery.test.ts`，覆盖：

- 顶层入口在校验后替换为根外目录链接。
- 深层目录在递归前替换为根外链接。
- 深层普通文件在复制前替换为链接或目录。
- 目录自环和文件链接不会被递归或复制。
- 中途复制失败不会留下最终目录或可见半成品。
- 目标名称竞争不会覆盖已有技能。
- Windows 分隔符、大小写和驱动器前缀边界。

## 5. HMR 真实 watcher/restart

### 5.1 分层职责

`vendor/kernel-hmr` 继续只提供：

- `watch(id, restart)` 注册重启回调并绑定 fiber 生命周期。
- `restart(id)` 执行已注册回调。
- `stop(id)` 幂等移除注册并执行注销清理。

真实文件 watcher 属于宿主适配层，不引入到 kernel vendor 包。宿主适配器负责路径监听、事件去抖、串行重启和错误日志；插件重载事务仍由调用方的 restart callback 决定。

### 5.2 watcher 行为

开发模式下，宿主适配器提供类似以下语义的端口：

```ts
interface HostHmrWatcher {
  watchPath(id: string, fileOrDirectory: string, restart: () => Promise<void>): () => Promise<void>;
}
```

约束如下：

- 监听启动失败立即返回可诊断错误，不留下半注册 watcher。
- 同一目标的连续 `rename/change` 事件在短窗口内合并为一次 restart。
- 同一目标的 restart 串行执行；前一次未结束时不并发启动下一次。
- restart 失败不删除 HMR 注册；下一次变更仍可重试，并记录失败原因。
- watcher disposer 先停止底层监听，再停止对应 HMR 注册；重复 dispose 安全。
- 生产模式不启动文件 watcher，生产 session 仍只接受注入的动态 spine。

### 5.3 测试验收

新增 host adapter 的 Node/Vitest 测试，并扩展 `vendor/kernel-hmr/tests/hmr.spec.ts`：

- 临时目录文件变更触发一次 restart。
- 连续重复事件经去抖后只触发一次。
- restart 回调未完成时不会并发执行。
- restart rejection 后注册仍存在，后续事件可再次触发。
- watcher dispose 后变更不再触发回调。
- fiber dispose 会清理 watcher 和 HMR registration。
- watcher 启动失败不会污染 kernel scope。

## 6. 外部 UI panel/settings 真实端到端测试

### 6.1 验收边界

本阶段 UI 验收以真实桌面宿主为准，同时保留现有 renderer/jsdom 快速测试。端到端测试只验证跨边界组合，不重复覆盖所有 slot registry 算法细节。

测试 fixture 包含一个自包含 client 模块：

- 注册一个具有稳定 `id` 的外部 panel。
- 注册一个具有稳定 `id`、图标和可访问名称的 settings section。
- 渲染文本必须可由测试稳定定位，不依赖像素坐标或第三方组件实现。

### 6.2 测试流程

1. 构建 fixture plugin，使其 client 入口进入 staging 插件资源，并在 manifest 中标记为 `client: true`。
2. 启动真实桌面宿主，等待主进程、preload、renderer 和插件清单就绪。
3. 通过 `innocence-plugin://` 加载 client 模块，确认插件 client 注册完成。
4. 打开工作台，验证外部 panel 的标签和内容出现在真实界面，并能通过现有导航切换。
5. 打开设置，验证外部 settings section 出现在设置导航，切换后内容呈现且不破坏内置 section。
6. 停用或移除 fixture plugin，触发清单重放；验证 panel/settings 贡献撤销，且槽位回落为内置内容。
7. 关闭宿主并确认测试进程、临时目录、watcher 和窗口均已清理。

测试实现应优先使用可访问性查询或 DOM 语义查询；只有在现有测试工具无法表达时，才使用宿主提供的最小黑盒桥接。所有失败必须保留 renderer 日志、主进程日志和最终页面状态。

### 6.3 测试隔离

- fixture 插件只存在于测试 staging 或临时用户插件根，不修改真实用户目录。
- 测试不得依赖用户已有插件、设置或工作区内容。
- 每个用例独立创建临时数据目录，退出路径使用 `finally` 清理。
- 真实宿主测试设置明确超时，并在超时后先收集诊断再终止自身子进程；不得结束无关用户进程。

## 7. `allowStaticSpine` 测试专用化

### 7.1 运行时策略

生产 session 创建必须满足：

- 调用方传入动态注入的 `SessionSpineSuite`；或
- 在非生产的显式测试 fixture 中使用静态 suite。

当生产模式缺少注入 spine 且未经过测试 helper 授权时，抛出稳定错误：

```text
production session requires an injected spine suite
```

普通产品代码、主进程启动路径和真实宿主 acceptance 不得传入 `allowStaticSpine: true`。

### 7.2 测试 API

提供统一测试 helper，集中创建带静态 suite 的自含 session。现有测试逐步由散落的 `allowStaticSpine: true` 改为 helper；`allowStaticSpine` 字段保留兼容读取，但在类型和文档中标注为 test-only，避免继续扩散。

### 7.3 测试验收

- production + 无 spine 必须失败。
- 非生产 test helper 可以创建 session。
- 注入 suite 的 child session、route session 和 restart recovery 继续使用同一 suite 实例。
- 真实 host boot 不依赖静态回退。
- 搜索生产 source 和 acceptance fixture，不应出现 `allowStaticSpine: true`。

## 8. `out` 锁清理与 Forge package 验证

### 8.1 清理原则

- 只处理本仓库生成的 `out` 目录及其已知 package 产物。
- 清理前确认路径位于仓库根下，不使用模糊通配符删除其他目录。
- 若删除失败，先收集文件占用和 package 进程诊断；不得强制终止无关进程。
- 清理成功后重新执行完整 package，不把旧 package 当作新验证结果。

### 8.2 最终验证链

按以下顺序运行：

```cmd
npm test
npm run typecheck
npm run typecheck:packages
npm run package
npm run package:smoke
```

Package 验收至少包括：

- Forge package 命令成功完成。
- 产物目录包含 `.vite`、插件 staging 资源、运行时 node-pty 所需文件和 assets。
- 平台 native 资源只保留当前目标平台允许的内容。
- 外部插件双根资源可读，manifest 与 client 入口一致。
- packaged exit smoke 能启动并干净退出，不留下由测试自身创建的锁或句柄。
- package 失败时输出具体阶段（构建、复制、资源裁剪、启动或退出），不静默吞错。

## 9. 文件与模块变更范围

预计修改或新增的范围如下，实施时仍需以现有实现为准：

- `src/main/skillDiscovery.ts` 及其测试。
- HMR 宿主适配器及对应测试；`vendor/kernel-hmr` 仅在 API 或生命周期测试需要时修改。
- 真实宿主 acceptance fixture、测试插件 client 和测试清理工具。
- `packages/harness-electron` 的测试 helper、session option 注释和相关测试。
- `scripts/` 下的 `out` preflight/打包验收辅助逻辑，以及 package acceptance 测试。
- 必要时补充阶段 4 文档，但不改动与本阶段无关的架构和 UI 文件。

任何新增 package 必须包含 `package.json`、`tsconfig.json`、`typecheck` script 和非 UI 测试；若实现留在 host，提交说明必须解释为何不适合 capability package。

## 10. 验收矩阵

| 能力 | 快速测试 | 集成/真实宿主测试 | 通过条件 |
| --- | --- | --- | --- |
| 技能递归复制 | Node/Vitest 临时目录与注入竞态 | IPC 导入门禁回归 | 所有递归边界拒绝越界，失败无半成品 |
| HMR | kernel registration + host watcher | 开发模式 watcher smoke | 变更只触发一次串行 restart，dispose 完整 |
| 外部 panel | slot/loader jsdom | 真实桌面宿主 acceptance | 注册、呈现、停用撤销完整 |
| 外部 settings | slot/loader jsdom | 真实桌面宿主 acceptance | 设置导航和内容可达，内置项不回归 |
| spine policy | session/unit tests | boot/session integration | 生产只接受动态注入，静态仅测试 helper |
| Forge package | resource/prune assertions | package smoke | `out` 无残留锁，产物可启动并退出 |

## 11. 风险与缓解

- **真实宿主测试在 CI 环境缺少图形能力：** 测试 harness 必须提供无头或最小窗口模式；若环境确实不具备启动条件，输出明确的环境阻塞证据，不以放宽断言替代验收。
- **文件 watcher 事件平台差异：** 测试断言事件最终语义，不断言底层事件数量；去抖和串行队列由适配器统一处理。
- **Windows 文件锁导致 package 不稳定：** package 前置检查只清理本项目产物，失败时保留诊断并停止，不循环重试。
- **递归复制竞态难以稳定复现：** 使用注入式文件系统端口或受控 hook 模拟替换点，同时保留至少一个真实符号链接/目录边界测试。
- **测试 helper 扩散静态 suite：** 通过 source grep、生产集成测试和代码审查共同约束；真实宿主 acceptance 不允许静态 fallback。

## 12. 完成定义

阶段 4 只有在以下条件全部满足后才算完成：

1. 技能复制的递归 TOCTOU 测试全部通过，并验证失败清理和原子提交。
2. 真实 watcher 能触发受控 HMR restart，且重启失败、重复事件和 dispose 行为有测试证据。
3. 真实桌面宿主端到端测试验证外部 panel/settings 的加载、呈现和撤销。
4. `allowStaticSpine` 只出现在测试 helper 或明确的自含 fixture 语境中，生产动态 spine 约束有回归测试。
5. `out` 清理后 `npm run package` 和 `npm run package:smoke` 使用新产物成功完成。
6. `npm test`、`npm run typecheck` 和 `npm run typecheck:packages` 全部成功，且没有覆盖用户已有工作树改动。
