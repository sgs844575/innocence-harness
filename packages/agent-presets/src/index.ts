import { codeReviewPreset } from "./presets/codeReview";
import { debuggerPreset } from "./presets/debugger";
import { gitWorkerPreset } from "./presets/gitWorker";
import { implementerPreset } from "./presets/implementer";
import { perfAnalystPreset } from "./presets/perfAnalyst";
import { plannerPreset } from "./presets/planner";
import { securityReviewPreset } from "./presets/securityReview";
import { simplifyPreset } from "./presets/simplify";
import { summarizerPreset } from "./presets/summarizer";
import { testEngineerPreset } from "./presets/testEngineer";

export {
  codeReviewPreset,
  debuggerPreset,
  gitWorkerPreset,
  implementerPreset,
  perfAnalystPreset,
  plannerPreset,
  securityReviewPreset,
  simplifyPreset,
  summarizerPreset,
  testEngineerPreset,
};

/**
 * 改编预设目录（B1 内容主体）：六个人设的英文结构重组重写——绝非逐字复制。
 * 本包不依赖 plugin-subagent：预设以对象字面量导出，SubagentPreset 的结构
 * 兼容性由 plugin-subagent 消费点（createSubagentPlugin 的 options 类型）校验。
 */
export const adaptedPresets = [
  codeReviewPreset,
  securityReviewPreset,
  plannerPreset,
  gitWorkerPreset,
  simplifyPreset,
  summarizerPreset,
] as const;

/** 原创编码人设目录：实现/测试/调试/性能分析，与改编目录同构导出。 */
export const codingPresets = [
  implementerPreset,
  testEngineerPreset,
  debuggerPreset,
  perfAnalystPreset,
] as const;
