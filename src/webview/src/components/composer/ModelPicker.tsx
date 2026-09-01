import { useMemo, useState } from "react";
import { Check, ChevronDown, Search } from "lucide-react";
import { PROVIDER_PRESET_MIRROR, type HarnessSettings, type ProviderKind, type ProviderProfile } from "../../../../shared/ipc";
import { CapabilityTags } from "../tags/CapabilityTags";
import { BrandIcon } from "../icons/BrandIcon";
import { Popover } from "../ui/Popover";
import { filterProfiles } from "./modelPickerFilter";

interface Props {
  settings: HarnessSettings;
  activeProfileId: string;
  activeModel: string;
  onSelect: (profileId: string, modelId: string) => void;
}

/** 二级模型选择器：厂家列 → 模型列；chip 显示厂家和模型名。 */
export function ModelPicker({ settings, activeProfileId, activeModel, onSelect }: Props): React.JSX.Element {
  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState(activeProfileId);
  const profiles = useMemo(() => filterProfiles(settings, query), [settings, query]);
  const current = profiles.find((p) => p.id === focused) ?? profiles[0];
  const activeProfile = settings.profiles.find((profile) => profile.id === activeProfileId);
  const activeModelInfo = activeProfile?.models.find((model) => model.id === activeModel);
  const modelLabel = activeModelInfo?.name?.trim() || activeModel;
  const label = activeProfile ? `${profileLabel(activeProfile)} / ${modelLabel}` : modelLabel;

  return (
    <Popover
      align="end"
      contentClassName="w-[340px] overflow-hidden"
      trigger={
        <button
          type="button"
          data-model-picker-trigger
          className="flex max-w-[220px] items-center gap-2 rounded-md px-1.5 py-1 text-(--color-app-text) hover:bg-(--color-app-hover)"
        >
          <BrandIcon subject={`${activeProfile ? `${activeProfile.name} ${activeProfile.kind}` : ""} ${activeModel}`} color size={14} />
          <span className="truncate">{label}</span>
          <ChevronDown size={11} className="shrink-0 text-(--color-app-faint)" />
        </button>
      }
    >
      <div className="border-b border-(--color-app-hairline) p-2">
        <div className="flex items-center gap-1.5 rounded-lg border border-(--color-app-hairline) bg-(--color-app-bg) px-2 py-1">
          <Search size={12} className="text-(--color-app-muted)" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索模型…"
            className="w-full bg-transparent outline-none placeholder:text-(--color-app-muted)"
          />
        </div>
      </div>
      {/* Two panes scroll independently; the popover never grows past 60vh
          even with hundreds of models (OpenRouter/Ollama) or many providers. */}
      <div className="flex max-h-[min(60vh,420px)] min-h-[196px]">
        <div className="scrollbar-thin w-[104px] shrink-0 overflow-y-auto border-r border-(--color-app-hairline) py-1">
          {profiles.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setFocused(p.id)}
              className={`flex w-full items-center gap-2 px-2.5 py-1.5 text-left ${p.id === current?.id ? "bg-(--color-app-accent-soft) text-(--color-app-text) shadow-[inset_2px_0_0_var(--color-app-accent)]" : "text-(--color-app-muted) hover:bg-(--color-app-bubble)/50"}`}
            >
              <span className="truncate">{profileLabel(p)}</span>
              <ProtocolBadge kind={p.kind} />
            </button>
          ))}
        </div>
        <div className="scrollbar-thin flex-1 overflow-y-auto py-1">
          {current?.models.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => onSelect(current.id, m.id)}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-(--color-app-bubble)/50"
            >
              <span className="truncate font-mono ">{m.name ?? m.id}</span>
              <CapabilityTags model={m} />
              {m.contextWindow != null && (
                <span className="ml-auto shrink-0 rounded-full border border-(--color-app-hairline) px-1.5 font-mono text-(--color-app-muted)">
                  {Math.round(m.contextWindow / 1000)}K
                </span>
              )}
              {m.id === activeModel && current.id === activeProfileId && <Check size={12} className="shrink-0 text-(--color-app-accent)" />}
            </button>
          ))}
        </div>
      </div>
    </Popover>
  );
}

function profileLabel(profile: ProviderProfile): string {
  const name = profile.name.trim();
  if (name) return name;
  return PROVIDER_PRESET_MIRROR.find((preset) => preset.kind === profile.kind)?.name ?? "Provider";
}

function ProtocolBadge({ kind }: { kind: ProviderKind }): React.JSX.Element {
  const protocol = kind === "anthropic"
    ? "anthropic-messages"
    : kind === "google"
      ? "google-generative"
      : "openai-compatible";
  return (
    <span className="ml-auto shrink-0 rounded border border-(--color-app-hairline) px-1 font-mono text-(--color-app-muted)">
      {protocol}
    </span>
  );
}
