import type { ComputerActivitySnapshot } from "@innocenceharness/tools-computer/activity";
import { createT } from "../../lib/i18n";

export function activityCopy(locale: string, activity: ComputerActivitySnapshot) {
  const t = createT(locale);
  const name = activity.toolName.toLowerCase();
  const action = /screenshot|capture|snapshot/.test(name) ? "screenshot"
    : /click/.test(name) ? "click" : /type|input_text/.test(name) ? "type"
    : /key|hotkey/.test(name) ? "key" : /scroll/.test(name) ? "scroll" : "generic";
  return {
    title: t('computerActivity.' + activity.status),
    detail: activity.status !== "running" ? t("computerActivity.settled")
      : activity.activeCount > 1 ? t("computerActivity.parallel").replace("{count}", String(activity.activeCount))
      : t('computerActivity.' + action),
    stop: t("computerActivity.stop"),
    stopping: t("computerActivity.stopping"),
    stopLabel: t("computerActivity.stopLabel"),
    stopError: t("computerActivity.stopError"),
  };
}
