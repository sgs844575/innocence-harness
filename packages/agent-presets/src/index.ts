import { codeReviewPreset } from "./presets/codeReview";
import { gitWorkerPreset } from "./presets/gitWorker";
import { plannerPreset } from "./presets/planner";
import { securityReviewPreset } from "./presets/securityReview";
import { simplifyPreset } from "./presets/simplify";
import { summarizerPreset } from "./presets/summarizer";

export { codeReviewPreset, gitWorkerPreset, plannerPreset, securityReviewPreset, simplifyPreset, summarizerPreset };

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
