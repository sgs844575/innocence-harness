// 设置页"技能"节：外部技能发现/导入。挂载时经 IPC skills:discover 拉清单
//（名称/描述/来源/已导入徽标），每条目一个导入按钮；导入后重拉清单并给出
// 结果反馈；已导入条目不可重复导入。导入失败经 IPC 抛错在此展示。
// 并列"外部 MCP 配置"块（同分区）：项目根 .mcp.json 发现提示 + 一键导入
//（合并进 .innocence/config.json，同名跳过），结果反馈 imported/skipped。
import { useCallback, useEffect, useState } from "react";
import type { DiscoveredSkillMirror, HarnessSettings, McpImportResultMirror } from "../../../../shared/ipc";
import { api } from "../../lib/ipc";
import { SettingRow } from "./BasicSections";
import { Switch } from "../ui/Switch";

type Feedback = { kind: "ok" | "error"; text: string } | null;

/** 并列块：项目 .mcp.json 发现提示 + 导入按钮 + 结果反馈。 */
function McpImportBlock({ t, workspaceRoot }: { t: (key: string) => string; workspaceRoot: string }): React.JSX.Element | null {
  const [found, setFound] = useState<string | null | undefined>(undefined); // undefined = probing
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<McpImportResultMirror | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    if (!workspaceRoot) return;
    void api
      .discoverMcpFile(workspaceRoot)
      .then(setFound, () => setFound(null));
  }, [workspaceRoot]);

  useEffect(refresh, [refresh]);

  // 无项目 / 探测中 / 未发现 .mcp.json：整块不渲染。
  if (!workspaceRoot || found === null || found === undefined) return null;

  const doImport = (): void => {
    setBusy(true);
    setError(null);
    void api
      .importMcpServers(workspaceRoot, "") // 空文本：main 代读 .mcp.json
      .then(setResult, (err: unknown) => setError(String(err)))
      .finally(() => setBusy(false));
  };

  return (
    <div className="px-3.5 py-3" data-testid="mcp-import-block">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="">{t("settings.mcp.title")}</p>
          <p className="mt-0.5 truncate text-(--color-app-muted)" title={found}>
            {t("settings.mcp.found").replace("{path}", found)}
          </p>
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={doImport}
          className="rounded-lg border border-(--color-app-hairline) px-2.5 py-1 text-(--color-app-text) hover:bg-(--color-app-bubble) disabled:opacity-50"
        >
          {busy ? t("settings.mcp.importing") : t("settings.mcp.import")}
        </button>
      </div>
      {result && (
        <p className="mt-2 text-(--color-app-accent)" role="status">
          {t("settings.mcp.importDone")
            .replace("{imported}", String(result.imported.length))
            .replace("{skipped}", String(result.skipped.length))}
          {result.imported.length > 0 ? `：${result.imported.join(", ")}` : ""}
        </p>
      )}
      {error && (
        <p className="mt-2 text-red-500" role="alert">
          {t("settings.mcp.importFailed")} ({error})
        </p>
      )}
    </div>
  );
}

export function SkillsSection({
  t,
  workspaceRoot,
  settings,
  onSettingsChange,
}: {
  t: (key: string) => string;
  workspaceRoot: string;
  settings: HarnessSettings;
  onSettingsChange: (next: HarnessSettings) => void;
}): React.JSX.Element {
  const [list, setList] = useState<DiscoveredSkillMirror[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const externalDiscoveryEnabled = settings.externalSkillDiscovery !== false;

  const refresh = useCallback(() => {
    if (!externalDiscoveryEnabled) {
      setList([]);
      return;
    }
    void api
      .discoverSkills()
      .then(setList, () => setList([]));
  }, [externalDiscoveryEnabled]);

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
      <SettingRow
        label={t("settings.skills.discovery")}
        desc={t("settings.skills.discoveryDesc")}
      >
        <Switch
          checked={externalDiscoveryEnabled}
          onChange={(value) => onSettingsChange({ ...settings, externalSkillDiscovery: value })}
          aria-label={t("settings.skills.discovery")}
        />
      </SettingRow>
      {!externalDiscoveryEnabled ? (
        <p className="px-3.5 py-6 text-center text-(--color-app-muted)">
          {t("settings.skills.discoveryDisabled")}
        </p>
      ) : list === null ? (
        <p className="px-3.5 py-6 text-center text-(--color-app-muted)">
          {t("settings.skills.loading")}
        </p>
      ) : list.length === 0 ? (
        <p className="px-3.5 py-6 text-center text-(--color-app-muted)">
          {t("settings.skills.empty")}
        </p>
      ) : (
        list.map((skill) => (
          <SettingRow
            key={`${skill.origin}/${skill.name}`}
            label={skill.name}
            desc={
              <span className="mt-0.5 flex items-center gap-1.5 text-(--color-app-muted)">
                {skill.description}
                <span className="rounded-full border border-(--color-app-hairline) px-1.5 py-0.5 leading-none">
                  {t(`settings.skills.origin.${skill.origin}`)}
                </span>
              </span>
            }
          >
            {skill.imported ? (
              <span className="text-(--color-app-muted)">
                {t("settings.skills.importedBadge")}
              </span>
            ) : (
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => doImport(skill)}
                className="rounded-lg border border-(--color-app-hairline) px-2.5 py-1 text-(--color-app-text) hover:bg-(--color-app-bubble) disabled:opacity-50"
              >
                {busy === skill.name ? t("settings.skills.importing") : t("settings.skills.import")}
              </button>
            )}
          </SettingRow>
        ))
      )}
      {feedback && (
        <p
          className={`px-3.5 py-2 ${
            feedback.kind === "ok" ? "text-(--color-app-accent)" : "text-red-500"
          }`}
          role="status"
        >
          {feedback.text}
        </p>
      )}
      <McpImportBlock t={t} workspaceRoot={workspaceRoot} />
      <p className="px-3.5 py-3 text-(--color-app-muted)">{t("settings.skills.note")}</p>
    </div>
  );
}
