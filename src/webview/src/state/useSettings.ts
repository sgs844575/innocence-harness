// 设置：装载 + 补丁提交（main 合并最新已提交设置，返回投影）。
import { useCallback, useEffect, useState } from "react";
import type { HarnessSettings } from "../../../shared/ipc";
import type { HarnessSettingsPatch } from "../../../shared/settingsPatch";
import { api, hasBridge } from "../lib/ipc";

export interface SettingsController {
  settings: HarnessSettings | null;
  patch: (patch: HarnessSettingsPatch) => Promise<void>;
}

export function useSettings(): SettingsController {
  const [settings, setSettings] = useState<HarnessSettings | null>(null);

  useEffect(() => {
    if (!hasBridge()) return;
    void api.getHarnessSettings().then(setSettings).catch(() => undefined);
  }, []);

  const patch = useCallback(async (next: HarnessSettingsPatch) => {
    const committed = await api.setHarnessSettings(next);
    setSettings(committed);
  }, []);

  return { settings, patch };
}
