import { useMemo, useState } from "react";
import { Check, ChevronDown, ChevronRight, Settings2 } from "lucide-react";
import { PROVIDER_PRESET_MIRROR, type HarnessSettings, type ProviderProfile } from "../../../../shared/ipc";
import { DropdownMenu, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuSub } from "../ui/DropdownMenu";

interface Props {
  t: (key: string) => string;
  settings: HarnessSettings;
  activeProfileId: string;
  activeModel: string;
  onSelect: (profileId: string, modelId: string) => void;
  /** 「管理模型」入口——跳设置模型分区；缺省不渲染该项。 */
  onManageModels?: () => void;
}

/** 启用厂家（模型为空的不列）。 */
export function enabledProfiles(settings: HarnessSettings): ProviderProfile[] {
  return settings.profiles.filter((p) => p.enabled && p.models.length > 0);
}

/** 两级模型选择器：192px 厂家列 → 右拉子菜单选模型；chip 显示厂家和模型名。 */
export function ModelPicker({ t, settings, activeProfileId, activeModel, onSelect, onManageModels }: Props): React.JSX.Element {
  const profiles = useMemo(() => enabledProfiles(settings), [settings]);
  // 子菜单受控：悬停由 Radix 内部驱动，点击兜底强制展开（无 hover 序列的环境
  // 也能开出模型子菜单）。
  const [openProfileId, setOpenProfileId] = useState<string | null>(null);
  const activeProfile = settings.profiles.find((profile) => profile.id === activeProfileId);
  const activeModelInfo = activeProfile?.models.find((model) => model.id === activeModel);
  const modelLabel = activeModelInfo?.name?.trim() || activeModel;
  const label = activeProfile ? `${profileLabel(activeProfile)} / ${modelLabel}` : modelLabel;

  return (
    <DropdownMenu
      contentClassName="w-48"
      trigger={
        <button
          type="button"
          data-model-picker-trigger
          aria-label={label}
          title={label}
          className="flex max-w-[220px] items-center gap-2 rounded-md px-1.5 py-1 text-(--color-foreground) outline-none hover:bg-(--color-hover)"
        >
          <span className="truncate">{label}</span>
          <ChevronDown size={11} className="shrink-0 text-(--color-faint)" />
        </button>
      }
    >
      <div className="scrollbar-thin max-h-[min(60vh,420px)] overflow-y-auto">
        {profiles.map((profile) => (
          <DropdownMenuSub
            key={profile.id}
            open={openProfileId === profile.id}
            onOpenChange={(open) => setOpenProfileId(open ? profile.id : null)}
            contentClassName="scrollbar-thin max-h-[min(60vh,420px)] w-56 overflow-y-auto"
            trigger={
              <span className="flex w-full items-center gap-2" onClick={() => setOpenProfileId(profile.id)}>
                <span className="min-w-0 flex-1 truncate">{profileLabel(profile)}</span>
                {profile.id === activeProfileId && <Check size={12} className="shrink-0 text-(--color-accent)" />}
                <ChevronRight size={11} className="ml-auto shrink-0 text-(--color-faint)" />
              </span>
            }
          >
            {profile.models.map((model) => (
              <DropdownMenuItem key={model.id} onSelect={() => onSelect(profile.id, model.id)}>
                <span className="flex w-full items-center gap-2">
                  <span className="min-w-0 flex-1 truncate font-mono">{model.name ?? model.id}</span>
                  {model.id === activeModel && profile.id === activeProfileId && (
                    <Check size={12} className="shrink-0 text-(--color-accent)" />
                  )}
                </span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuSub>
        ))}
      </div>
      {onManageModels && (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={onManageModels}>
            <span className="flex items-center gap-2">
              <Settings2 size={13} className="text-(--color-muted)" />
              {t("composer.manageModels")}
            </span>
          </DropdownMenuItem>
        </>
      )}
    </DropdownMenu>
  );
}

function profileLabel(profile: ProviderProfile): string {
  const name = profile.name.trim();
  if (name) return name;
  return PROVIDER_PRESET_MIRROR.find((preset) => preset.kind === profile.kind)?.name ?? "Provider";
}
