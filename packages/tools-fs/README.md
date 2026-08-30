# tools-fs — 文件系统工具插件（Read / Write / Edit / Glob / Grep）

`@innocenceharness/tools-fs` 一次性注册五个工作区文件工具，全部路径经 `resolveWithin` 限定在工作区根内
（越根直接抛"路径越出工作区"），并各自声明权限资源与脱敏持久化参数。

## 作用与工具一览

| 工具 | 参数 | 说明 |
|---|---|---|
| `Read` | `path`、`offset?`（1 起）、`limit?` | 读文件，输出 `行号\t内容`（cat -n 风格），只读 |
| `Write` | `path`、`content` | 整文件覆盖写，自动创建父目录 |
| `Edit` | `path`、`old_string`、`new_string`、`replace_all?` | 精确串替换；0 次命中提示先 Read，多次命中且未开 `replace_all` 报不唯一 |
| `Glob` | `pattern`（`** * ? {a,b}`）、`path?` | 按模式列工作区相对路径 |
| `Grep` | `pattern`（正则）、`glob?`、`path?` | 内容搜索，输出 `文件:行号: 内容` |

## 公开 API

| 导出 | 说明 |
|---|---|
| `FsPlugin` | 内核插件（name `fs`），激活时注册全部五个工具 |
| `createReadTool(registry)` / `writeTool` / `editTool` / `globTool` / `grepTool` | 各工具本体，可单独注册；Read 为工厂形式——绑定一份会话级已读登记（直接单测的调用方自建 `createReadFileRegistry()`），其余为成品对象 |
| `createReadFileRegistry` | 会话内已读文件登记（M2 文件状态跟踪）：磁盘签名 + 覆盖面，按 `scope.parentInvocationId` 分桶隔离子代理运行 |
| `resolveWithin(root, target)` | 工作区路径约束（越根即抛） |
| `walkFiles` | 有界递归列文件（与 Glob/Grep 共用忽略表） |
| `IGNORED_DIRS` | 忽略目录集合：`node_modules / .git / .vite / out / dist / build / .innocence` |

## 使用

```ts
import { FsPlugin } from "@innocenceharness/tools-fs";

plugins.push(FsPlugin); // 宿主接线见 src/main/harnessGlue.ts（插件开关 id: fs，core 恒开）
```

## 关键行为与约束

- **上限**：Read 单次 2000 行，截断时尾注提示用 `offset` 续读；Glob/Grep 遍历文件数上限 500、Grep 命中行上限 200，
  达标都带尾注；Grep 跳过 >2MB 文件，行内容 trim 后截 200 字符。
- **权限资源**：`Read = read:path`；`Write/Edit = write:path`；`Glob/Grep = read:search`（scope 为被搜目录，整工作区为 `"."`）。
- **持久化脱敏**：Write/Edit 只存 `path + contentLength + contentSha256`——文件内容绝不进历史 / 事件 / 审计。
- **会话已读登记（M2）**：`FsPlugin.apply` 每会话创建一份已读注册表；同一文件重复读取时尾注提示"已读过且磁盘未变更（完整/部分口径）"或"磁盘已变更"（mtime+size 签名，签名相同视为未变更）；子代理运行经 `scope.parentInvocationId` 自动分桶，父子互不可见。
- `Edit` 的 `old_string` 匹配要求唯一（或显式 `replace_all`），强制"先读后改"的工作流。

## 测试

```bash
npx vitest run packages/tools-fs
```

`tests/fs.test.ts` 覆盖五个工具的行为、路径约束、截断与脱敏。
