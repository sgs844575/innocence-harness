// Agent 模式维度的宿主侧回退提示词。模式本身由插件注册（AgentsService +
// PromptFragment），此处仅保留"任何模式都未命中"时的最小 base（文本迁移自
// 原 DEFAULT_SYSTEM_PROMPT，行为不变）。
// 注意：src/shared/ipc.ts 镜像了设置字段（shared 不 import 包），修改时必须
// 同步那一侧（tests/mirror.test.ts 有 drift-guard）。

export const BUILTIN_FALLBACK_PROMPT =
  "你是 InnocenceHarness 的编程助手。你可以调用工具读写工作区文件。\n" +
  "约定：引用代码位置用 `文件路径:行号`；修改文件前先 Read 确认原文；" +
  "工具失败时读取错误信息自行纠正，不要重复同样的失败调用；" +
  "回答用用户的语言，简洁直接。";
