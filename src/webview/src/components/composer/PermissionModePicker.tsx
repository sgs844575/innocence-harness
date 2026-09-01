import { ChevronDown, ShieldCheck } from "lucide-react";
import type { PermissionMode } from "../../../../shared/ipc";
import { Popover } from "../ui/Popover";

const MODES: PermissionMode[] = ["full", "auto", "ask", "plan"];

export function PermissionModePicker({
  t, value, onChange,
}: {
  t: (key: string) => string;
  value: PermissionMode;
  onChange: (mode: PermissionMode) => void;
}): React.JSX.Element {
  // 完全访问（full）用模式强调色（橙）标示危险档，其余默认色。
  const shieldCls = value === "full" ? "text-(--color-app-mode-accent)" : "";
  return (
    <Popover
      contentClassName="w-56 p-1"
      trigger={
        <button type="button" className={`flex items-center gap-1.5 rounded-md px-1.5 py-1 hover:bg-(--color-app-hover) ${value === "full" ? "text-(--color-app-mode-accent)" : "text-(--color-app-text)"}`}>
          <ShieldCheck size={14} className={shieldCls} />
          <span>{t(`permission.mode.${value}`)}</span>
          <ChevronDown size={11} className="text-(--color-app-faint)" />
        </button>
      }
    >
      {MODES.map((id) => (
        <button
          key={id}
          type="button"
          onClick={() => onChange(id)}
          className={`flex w-full flex-col items-start rounded-md px-2.5 py-1.5 text-left hover:bg-(--color-app-hover) ${
            id === value ? (id === "full" ? "text-(--color-app-mode-accent)" : "text-(--color-app-accent)") : "text-(--color-app-muted)"
          }`}
        >
          <span>{t(`permission.mode.${id}`)}</span>
          <span className="text-(--color-app-faint)">{t(`permission.mode.${id}.desc`)}</span>
        </button>
      ))}
    </Popover>
  );
}
