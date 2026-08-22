// 设置页"技能"节：外部技能发现/导入。挂载时经 IPC skills:discover 拉清单
//（名称/描述/来源/已导入徽标），每条目一个导入按钮；导入后重拉清单并给出
// 结果反馈；已导入条目不可重复导入。导入失败经 IPC 抛错在此展示。
import { useCallback, useEffect, useState } from "react";
import type { DiscoveredSkillMirror } from "../../../../shared/ipc";
import { api } from "../../lib/ipc";
import { SettingRow } from "./BasicSections";

type Feedback = { kind: "ok" | "error"; text: string } | null;

export function SkillsSection({ t }: { t: (key: string) => string }): React.JSX.Element {
  const [list, setList] = useState<DiscoveredSkillMirror[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);

  const refresh = useCallback(() => {
    void api
      .discoverSkills()
      .then(setList, () => setList([]));
  }, []);

  useEffect(refresh, [refresh]);

  const doImport = (skill: DiscoveredSkillMirror): void => {
    setBusy(skill.name);
    setFeedback(null);
    void api
      .importSkill(skill)
      .then(() => {
        setFeedback({ kind: "ok", text: t("settings.skills.importDone").replace("{name}", skill.name) });
        refresh();
      })
      .catch((err: unknown) => {
        setFeedback({
          kind: "error",
          text: t("settings.skills.importFailed").replace("{name}", skill.name) + ` (${String(err)})`,
        });
        refresh();
      })
      .finally(() => setBusy(null));
  };

  return (
    <div className="card divide-y divide-(--color-app-hairline)">
      {list === null ? (
        <p className="px-3.5 py-6 text-center text-sm text-(--color-app-muted)">
          {t("settings.skills.loading")}
        </p>
      ) : list.length === 0 ? (
        <p className="px-3.5 py-6 text-center text-sm text-(--color-app-muted)">
          {t("settings.skills.empty")}
        </p>
      ) : (
        list.map((skill) => (
          <SettingRow
            key={`${skill.origin}/${skill.name}`}
            label={skill.name}
            desc={
              <span className="mt-0.5 flex items-center gap-1.5 text-xs text-(--color-app-muted)">
                {skill.description}
                <span className="rounded-full border border-(--color-app-hairline) px-1.5 py-0.5 text-[10px] leading-none">
                  {t(`settings.skills.origin.${skill.origin}`)}
                </span>
              </span>
            }
          >
            {skill.imported ? (
              <span className="text-xs text-(--color-app-muted)">
                {t("settings.skills.importedBadge")}
              </span>
            ) : (
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => doImport(skill)}
                className="rounded-lg border border-(--color-app-hairline) px-2.5 py-1 text-xs text-(--color-app-text) hover:bg-(--color-app-bubble) disabled:opacity-50"
              >
                {busy === skill.name ? t("settings.skills.importing") : t("settings.skills.import")}
              </button>
            )}
          </SettingRow>
        ))
      )}
      {feedback && (
        <p
          className={`px-3.5 py-2 text-xs ${
            feedback.kind === "ok" ? "text-(--color-app-accent)" : "text-red-500"
          }`}
          role="status"
        >
          {feedback.text}
        </p>
      )}
      <p className="px-3.5 py-3 text-xs text-(--color-app-muted)">{t("settings.skills.note")}</p>
    </div>
  );
}
