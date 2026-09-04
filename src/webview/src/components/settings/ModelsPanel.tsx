// 模型设置面板（对齐市面 AI 工作台）：左列供应商清单（启用状态点 + 添加），
// 右侧所选供应商的名称/地址/密钥/启停与模型列表（添加/拉取/删除/设为当前）。
// 纯受控：所有写入经 diffSettingsSnapshot 生成可 rebase 补丁交给 onPatchSettings。
import { useState } from "react";
import { Box, Check, CirclePlus, LoaderCircle, RefreshCw, Trash2 } from "lucide-react";
import {
  PROVIDER_PRESET_MIRROR,
  type HarnessSettings,
  type ModelInfo,
  type ProviderProfile,
} from "../../../../shared/ipc";
import { diffSettingsSnapshot } from "../../../../shared/settingsPatch";
import type { HarnessSettingsPatch } from "../../../../shared/settingsPatch";
import { Switch } from "../ui/Switch";
import { AddModelDialog } from "./AddModelDialog";
import { ImportModelsDialog } from "./ImportModelsDialog";

interface Props {
  t: (key: string) => string;
  settings: HarnessSettings;
  onPatchSettings: (patch: HarnessSettingsPatch) => void;
  /** 保存供应商 API 密钥；缺省 = 不支持。 */
  onSetApiKey?: (profileId: string, apiKey: string) => void;
  /** 从供应商拉取模型清单（宿主 listProviderModels + enrichModels）。 */
  onFetchModels?: (profile: ProviderProfile) => Promise<ModelInfo[]>;
}

export function ModelsPanel({ t, settings, onPatchSettings, onSetApiKey, onFetchModels }: Props): React.JSX.Element {
  const profiles = settings.profiles;
  const [selectedId, setSelectedId] = useState<string | null>(settings.activeProfileId || profiles[0]?.id || null);
  const selected = profiles.find((profile) => profile.id === selectedId) ?? profiles[0] ?? null;
  const [addingProvider, setAddingProvider] = useState(false);
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const [urlDraft, setUrlDraft] = useState<string | null>(null);
  const [keyDraft, setKeyDraft] = useState<string | null>(null);
  const [addingModel, setAddingModel] = useState(false);
  const [fetching, setFetching] = useState(false);
  /** 拉取到的待导入候选（打开勾选弹窗）；null = 关闭。 */
  const [importing, setImporting] = useState<ModelInfo[] | null>(null);

  const commit = (next: HarnessSettings): void => onPatchSettings(diffSettingsSnapshot(settings, next));
  const mutateProfile = (id: string, changes: Partial<ProviderProfile>): void =>
    commit({ ...settings, profiles: profiles.map((p) => (p.id === id ? { ...p, ...changes } : p)) });

  const addProvider = (preset: (typeof PROVIDER_PRESET_MIRROR)[number] | null): void => {
    const id = `${preset?.kind ?? "custom"}-${Date.now().toString(36)}`;
    const profile: ProviderProfile = preset
      ? {
          id,
          name: preset.name,
          kind: preset.kind,
          apiKey: "",
          baseURL: preset.baseURL,
          enabled: true,
          models: preset.models.map((modelId) => ({ id: modelId, name: modelId, source: "preset" as const })),
          preset: true,
        }
      : {
          id,
          name: t("settings.models.customProvider"),
          kind: "openai",
          apiKey: "",
          baseURL: "",
          enabled: true,
          models: [],
        };
    commit({ ...settings, profiles: [...profiles, profile] });
    setSelectedId(id);
    setAddingProvider(false);
    setNameDraft(null);
    setUrlDraft(null);
    setKeyDraft(null);
  };

  const deleteProvider = (id: string): void => {
    const remaining = profiles.filter((p) => p.id !== id);
    const next: HarnessSettings = { ...settings, profiles: remaining };
    if (settings.activeProfileId === id) {
      next.activeProfileId = remaining[0]?.id ?? "";
      next.activeModel = remaining[0]?.models[0]?.id ?? "";
    }
    commit(next);
    if (selectedId === id) setSelectedId(remaining[0]?.id ?? null);
  };

  const addModel = (model: ModelInfo): void => {
    if (!selected || selected.models.some((item) => item.id === model.id)) return;
    mutateProfile(selected.id, { models: [...selected.models, model] });
    setAddingModel(false);
  };

  const fetchModels = (): void => {
    if (!selected || !onFetchModels) return;
    setFetching(true);
    void onFetchModels(selected)
      .then((fetched) => {
        // 拉取结果不直接落清单：排除已有 id 后交给导入弹窗勾选。
        const existing = new Set(selected.models.map((model) => model.id));
        const fresh = fetched.filter((model) => !existing.has(model.id));
        if (fresh.length > 0) setImporting(fresh);
      })
      .catch(() => undefined)
      .finally(() => setFetching(false));
  };

  const importModels = (models: ModelInfo[]): void => {
    if (!selected) return;
    mutateProfile(selected.id, { models: [...selected.models, ...models] });
    setImporting(null);
  };

  const rowLabel = "w-28 shrink-0 pt-1.5 text-(--color-muted)";
  const input =
    "w-full rounded-md border border-(--color-border) bg-(--color-surface) px-2.5 py-1.5 outline-none text-(--color-foreground) placeholder:text-(--color-faint) focus:border-(--color-accent)";

  return (
    <div className="flex min-h-[560px] overflow-hidden rounded-(--radius-pop) border border-(--color-border) bg-(--color-raised)">
      {/* 供应商列（定高自滚；添加钮钉在底部） */}
      <div className="flex w-56 shrink-0 flex-col border-r border-(--color-hairline) p-2">
        <div className="scrollbar-thin flex-1 space-y-px overflow-y-auto">
          {profiles.map((profile) => (
            <button
              key={profile.id}
              type="button"
              onClick={() => {
                setSelectedId(profile.id);
                setNameDraft(null);
                setUrlDraft(null);
                setKeyDraft(null);
              }}
              aria-pressed={selected?.id === profile.id}
              title={profile.name || profile.kind}
              className={`flex h-9 w-full items-center gap-2 rounded-md px-2.5 text-left ${
                selected?.id === profile.id
                  ? "bg-(--color-selected) font-medium text-(--color-foreground-strong)"
                  : "text-(--color-muted) hover:bg-(--color-hover)"
              }`}
            >
              <Box size={13} className="shrink-0" aria-hidden />
              <span className="min-w-0 flex-1 truncate">{profile.name || profile.kind}</span>
              <span
                aria-label={profile.enabled ? t("settings.models.enabled") : t("settings.models.disabled")}
                title={profile.enabled ? t("settings.models.enabled") : t("settings.models.disabled")}
                className={`size-1.5 shrink-0 rounded-full ${profile.enabled ? "bg-(--color-tool-ok)" : "bg-(--color-faint)"}`}
              />
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setAddingProvider((value) => !value)}
          aria-expanded={addingProvider}
          className="mt-1 flex h-9 shrink-0 items-center gap-2 rounded-md px-2.5 text-left text-(--color-muted) hover:bg-(--color-hover) hover:text-(--color-foreground)"
        >
          <CirclePlus size={13} className="shrink-0" aria-hidden />
          {t("settings.models.addProvider")}
        </button>
        {addingProvider && (
          <div className="dropdown-in mt-1 max-h-64 overflow-y-auto rounded-md border border-(--color-hairline) bg-(--color-surface) p-1" data-state="open">
            {PROVIDER_PRESET_MIRROR.map((preset) => (
              <button
                key={preset.name}
                type="button"
                onClick={() => addProvider(preset)}
                className="flex w-full items-center rounded px-2 py-1.5 text-left text-(--color-foreground) hover:bg-(--color-hover)"
              >
                {preset.name}
              </button>
            ))}
            <div className="mx-1 my-1 h-px bg-(--color-hairline)" />
            <button
              type="button"
              onClick={() => addProvider(null)}
              className="flex w-full items-center rounded px-2 py-1.5 text-left text-(--color-muted) hover:bg-(--color-hover) hover:text-(--color-foreground)"
            >
              {t("settings.models.customProvider")}
            </button>
          </div>
        )}
      </div>

      {/* 供应商详情 */}
      {selected ? (
        <div className="min-w-0 flex-1 p-4">
          <div className="flex items-center gap-2.5">
            <span className="min-w-0 flex-1 truncate font-bold text-(--color-foreground-strong)">
              {selected.name || selected.kind}
            </span>
            {settings.activeProfileId === selected.id && (
              <span className="rounded-full bg-(--color-selected) px-1.5 py-0.5 leading-none text-(--color-muted)">
                {t("settings.models.active")}
              </span>
            )}
            <Switch
              checked={selected.enabled}
              onChange={(enabled) => mutateProfile(selected.id, { enabled })}
              label={t("settings.models.enabled")}
            />
          </div>

          <div className="mt-4 space-y-3">
            <div className="flex items-start gap-3">
              <span className={rowLabel}>{t("settings.models.name")}</span>
              <input
                value={nameDraft ?? selected.name}
                onChange={(event) => setNameDraft(event.target.value)}
                onBlur={() => {
                  if (nameDraft !== null && nameDraft.trim() !== selected.name) {
                    mutateProfile(selected.id, { name: nameDraft.trim() });
                  }
                  setNameDraft(null);
                }}
                aria-label={t("settings.models.name")}
                className={input}
              />
            </div>
            <div className="flex items-start gap-3">
              <span className={rowLabel}>{t("settings.models.baseURL")}</span>
              <input
                value={urlDraft ?? selected.baseURL}
                onChange={(event) => setUrlDraft(event.target.value)}
                onBlur={() => {
                  if (urlDraft !== null && urlDraft.trim() !== selected.baseURL) {
                    mutateProfile(selected.id, { baseURL: urlDraft.trim() });
                  }
                  setUrlDraft(null);
                }}
                placeholder="https://api.example.com/v1"
                aria-label={t("settings.models.baseURL")}
                className={`${input} font-mono`}
              />
            </div>
            <div className="flex items-start gap-3">
              <span className={rowLabel}>{t("settings.models.apiKey")}</span>
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <input
                  value={keyDraft ?? selected.apiKey}
                  onChange={(event) => setKeyDraft(event.target.value)}
                  placeholder={t("settings.models.apiKey.notConfigured")}
                  aria-label={t("settings.models.apiKey")}
                  disabled={!onSetApiKey}
                  className={`${input} font-mono`}
                />
                <button
                  type="button"
                  disabled={!onSetApiKey}
                  onClick={() => {
                    const apiKey = keyDraft ?? selected.apiKey;
                    onSetApiKey?.(selected.id, apiKey);
                    setKeyDraft(apiKey);
                  }}
                  className="h-8 shrink-0 rounded-md bg-(--color-brand) px-3 text-(--color-inverse) transition-opacity hover:opacity-80 disabled:opacity-30"
                >
                  {t("settings.models.save")}
                </button>
              </div>
            </div>
          </div>

          {/* 模型列表（定高超出自滚；添加为图标钮，弹窗收集详情） */}
          <div className="mt-5 flex items-center gap-2">
            <span className="font-medium text-(--color-foreground-strong)">{t("settings.models.list")}</span>
            <div className="flex-1" />
            {onFetchModels && (
              <button
                type="button"
                onClick={fetchModels}
                disabled={fetching}
                title={t("settings.models.fetch")}
                className="flex h-7 items-center gap-1.5 rounded-md border border-(--color-border) px-2 text-(--color-muted) hover:bg-(--color-hover) hover:text-(--color-foreground) disabled:opacity-45"
              >
                {fetching ? <LoaderCircle size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                {t("settings.models.fetch")}
              </button>
            )}
            <button
              type="button"
              onClick={() => setAddingModel(true)}
              aria-label={t("settings.models.addModel")}
              title={t("settings.models.addModel")}
              className="grid size-7 place-items-center rounded-md border border-(--color-border) text-(--color-muted) hover:bg-(--color-hover) hover:text-(--color-foreground)"
            >
              <CirclePlus size={13} />
            </button>
          </div>
          <ul className="scrollbar-thin mt-2 max-h-[280px] space-y-1.5 overflow-y-auto">
            {selected.models.length === 0 && (
              <li className="rounded-md px-2.5 py-2 text-(--color-faint)">{t("settings.models.emptyModels")}</li>
            )}
            {selected.models.map((model) => {
              const active = settings.activeProfileId === selected.id && settings.activeModel === model.id;
              return (
                <li
                  key={model.id}
                  className="flex items-center gap-2 rounded-md border border-(--color-border) bg-(--color-surface) px-2.5 py-1.5"
                >
                  <button
                    type="button"
                    onClick={() => onPatchSettings({ activeProfileId: selected.id, activeModel: model.id })}
                    title={model.id}
                    className={`min-w-0 flex-1 truncate text-left font-mono ${
                      active ? "text-(--color-foreground-strong)" : "text-(--color-muted) hover:text-(--color-foreground)"
                    }`}
                  >
                    {model.name ?? model.id}
                  </button>
                  {model.vision && (
                    <span className="shrink-0 rounded bg-(--color-surface) px-1 py-0.5 leading-none text-(--color-faint)">
                      {t("settings.models.vision")}
                    </span>
                  )}
                  {model.contextWindow !== undefined && (
                    <span className="shrink-0 rounded bg-(--color-surface) px-1 py-0.5 leading-none font-mono text-(--color-faint)">
                      {model.contextWindow >= 1000 ? `${Math.round(model.contextWindow / 1000)}K` : model.contextWindow}
                    </span>
                  )}
                  {active && <Check size={13} className="shrink-0 text-(--color-accent)" />}
                  <button
                    type="button"
                    aria-label={`${t("settings.models.deleteModel")} ${model.id}`}
                    title={t("settings.models.deleteModel")}
                    onClick={() => {
                      const models = selected.models.filter((item) => item.id !== model.id);
                      mutateProfile(selected.id, { models });
                      if (active) onPatchSettings({ activeModel: models[0]?.id ?? "" });
                    }}
                    className="shrink-0 rounded p-1 text-(--color-faint) hover:text-(--color-tool-err)"
                  >
                    <Trash2 size={13} />
                  </button>
                </li>
              );
            })}
          </ul>

          <div className="mt-5 border-t border-(--color-hairline) pt-3">
            <button
              type="button"
              onClick={() => deleteProvider(selected.id)}
              className="flex h-8 items-center gap-1.5 rounded-md border border-(--color-tool-err)/40 px-3 text-(--color-tool-err) hover:bg-(--color-tool-err)/10"
            >
              <Trash2 size={13} />
              {t("settings.models.deleteProvider")}
            </button>
          </div>
        </div>
      ) : (
        <div className="grid flex-1 place-items-center p-6 text-(--color-muted)">{t("settings.models.empty")}</div>
      )}
      {addingModel && selected && (
        <AddModelDialog t={t} onClose={() => setAddingModel(false)} onSave={addModel} />
      )}
      {importing && selected && (
        <ImportModelsDialog t={t} models={importing} onClose={() => setImporting(null)} onImport={importModels} />
      )}
    </div>
  );
}
