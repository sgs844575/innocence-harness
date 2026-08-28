import { useEffect, useState } from "react";
import type { AgentModeInfo } from "../../../shared/ipc";

export interface AgentModesSource {
  listAgentModes(): Promise<AgentModeInfo[]>;
}

/** 模式目录（一次拉取；插件清单变化经 refresh 触发重拉）。 */
export function useAgentModes(api: AgentModesSource, refreshKey: unknown = null) {
  const [modes, setModes] = useState<AgentModeInfo[]>([{ id: "default", title: "Default" }]);
  useEffect(() => {
    let alive = true;
    api.listAgentModes().then((list) => { if (alive && list.length > 0) setModes(list); }).catch(() => {});
    return () => { alive = false; };
  }, [refreshKey]);
  return modes;
}
