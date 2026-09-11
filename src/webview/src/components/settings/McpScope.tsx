import { Folder, Monitor } from "lucide-react";
import { Select } from "../ui/Select";

export function McpScope({ value, spaces, disabled, onChange, t }: {
  value: string | null; spaces: { root: string; name: string }[]; disabled?: boolean;
  onChange: (value: string | null) => void; t: (key: string) => string;
}): React.JSX.Element {
  return <Select pill widePopup value={value ?? "__user__"} disabled={disabled} ariaLabel={t("settings.mcp.scope")} icon={value === null ? <Monitor size={14} strokeWidth={1.4} /> : <Folder size={14} strokeWidth={1.4} />} options={[
    { value: "__user__", label: t("settings.mcp.user"), icon: <Monitor size={14} /> },
    ...spaces.map((space) => ({ value: space.root, label: space.name, group: t("settings.mcp.workspace"), icon: <Folder size={14} /> })),
  ]} onChange={(next) => onChange(next === "__user__" ? null : next)} />;
}
