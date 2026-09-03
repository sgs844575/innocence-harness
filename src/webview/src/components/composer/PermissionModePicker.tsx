import { Check, ChevronDown, ShieldCheck } from "lucide-react";
import type { PermissionMode } from "../../../../shared/ipc";
import { Popover } from "../ui/Popover";

/** 菜单顺序对齐参考界面：变更前确认 / 自动编辑 / 计划模式 / 完全访问。 */
const MODES: PermissionMode[] = ["ask", "auto", "plan", "full"];

export function PermissionModePicker({
  t,
  value,
  onChange,
}: {
  t: (key: string) => string;
  value: PermissionMode;
  onChange: (mode: PermissionMode) => void;
}): React.JSX.Element {
  const accent = value === "full";
  return (
    <Popover
      contentClassName="w-64 p-1"
      trigger={
        <button
          type="button"
          aria-label={t("permission.mode")}
          title={t("permission.mode")}
          className={`flex items-center gap-1.5 rounded-md px-1.5 py-1 outline-none hover:bg-(--color-hover) ${
            accent ? "text-(--color-mode-accent)" : "text-(--color-foreground)"
          }`}
        >
          <ShieldCheck size={14} />
          <span>{t(`permission.mode.${value}`)}</span>
          <ChevronDown size={11} className={accent ? "" : "text-(--color-faint)"} />
        </button>
      }
    >
      {MODES.map((id) => (
        <button
          key={id}
          type="button"
          onClick={() => onChange(id)}
          className={`flex w-full items-start gap-2 rounded-lg px-2.5 py-1.5 text-left hover:bg-(--color-hover) ${
            id === value ? "text-(--color-foreground)" : "text-(--color-muted)"
          }`}
        >
          <span className="min-w-0 flex-1">
            <span className={`block ${id === "full" && id === value ? "text-(--color-mode-accent)" : ""}`}>
              {t(`permission.mode.${id}`)}
            </span>
            <span className="block text-(--color-faint)">{t(`permission.mode.${id}.desc`)}</span>
          </span>
          {id === value && <Check size={13} className="mt-1 shrink-0 text-(--color-accent)" />}
        </button>
      ))}
    </Popover>
  );
}
