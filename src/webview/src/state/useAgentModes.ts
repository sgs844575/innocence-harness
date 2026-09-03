// Agent 模式目录：装载时拉取 agents:modes（main 按 manifest + 用户根现算，
// 恒含 default），plugins:changed 后重拉以反映新装/移除的模式插件。
// 桥缺失（测试/纯浏览器）时仅含 default 兜底。
import { useEffect, useState } from "react";
import type { AgentModeInfo } from "../../../shared/ipc";
import { api, hasBridge } from "../lib/ipc";

const FALLBACK_MODES: AgentModeInfo[] = [{ id: "default", title: "Default" }];

export function useAgentModes(): AgentModeInfo[] {
  const [modes, setModes] = useState<AgentModeInfo[]>(FALLBACK_MODES);

  useEffect(() => {
    if (!hasBridge()) return;
    const refresh = () => void api.listAgentModes().then(setModes).catch(() => undefined);
    refresh();
    return api.onPluginsChanged(refresh);
  }, []);

  return modes;
}
