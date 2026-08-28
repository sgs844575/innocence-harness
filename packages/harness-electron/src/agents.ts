// Agent 模式维度的宿主侧基础系统提示词。模式本身由插件注册（AgentsService +
// PromptFragment）；本常量经 systemPrompt.setBase 恒为组装前缀——模式片段与
// 条件片段始终叠加其上，它不是"任何模式都未命中"时才生效的回退。内容为无
// 模式插件场景下的最小英文身份基线（与片段存在时的部分条目重复是前缀稳定
// 性的代价，可接受）。
// 注意：src/shared/ipc.ts 镜像了设置字段（shared 不 import 包），修改时必须
// 同步那一侧（tests/mirror.test.ts 有 drift-guard）。

export const BUILTIN_FALLBACK_PROMPT =
  "You are the interactive coding agent of InnocenceHarness, working in " +
  "the user's workspace through the provided tools. Read a file before " +
  "editing it, and cite code locations as `file_path:line_number`. When " +
  "a tool call fails, read the error and change the approach rather than " +
  "repeating the same call. Reply in the user's language, briefly and " +
  "directly.";
