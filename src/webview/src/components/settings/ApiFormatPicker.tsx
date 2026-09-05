import { Select } from "../ui/Select";
import type { ApiFormat } from "@innocenceharness/harness-providers";
import type { ProviderProfile } from "../../../../shared/ipc";

const formats: { value: ApiFormat; label: string }[] = [
  { value: "messages", label: "Messages (/v1/messages)" },
  { value: "chat-completions", label: "Chat Completions (/chat/completions)" },
  { value: "responses", label: "Responses (/responses)" },
  { value: "native-generative", label: "Native Generative" },
];

export function ApiFormatPicker({ profile, label, onChange }: {
  profile: ProviderProfile;
  label: string;
  onChange: (apiFormat: ApiFormat) => void;
}): React.JSX.Element {
  const value = profile.apiFormat ?? (profile.kind === "anthropic" ? "messages" : profile.kind === "google" ? "native-generative" : "chat-completions");
  return (
    <div className="flex items-start gap-3">
      <span className="w-28 shrink-0 pt-1.5 text-(--color-muted)">{label}</span>
      <div className="min-w-0 flex-1">
        <Select ariaLabel={label} value={value} options={formats} fullWidth
          onChange={(next) => onChange(next as ApiFormat)} />
      </div>
    </div>
  );
}
