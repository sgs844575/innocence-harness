// 活跃模型视觉能力（设置快照现读）：true=显式支持；false/undefined=否/未知。
// 与主进程发送门控同一口径（harnessGlue.activeModelVision 的渲染层镜像）。
import type { HarnessSettings } from "../../../shared/ipc";

export function activeModelVision(settings: HarnessSettings | null | undefined): boolean | undefined {
  if (!settings) return undefined;
  const profile = settings.profiles.find((candidate) => candidate.id === settings.activeProfileId);
  return profile?.models.find((candidate) => candidate.id === settings.activeModel)?.vision;
}
