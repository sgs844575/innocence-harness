import { Bot, Check, ChevronDown } from "lucide-react";
import { Popover } from "../ui/Popover";

export interface AgentModeOption { id: string; title: string; }

/** 内置模式用 i18n 显示；用户自建模式显示元数据 title。 */
export function labelFor(t: (k: string) => string, id: string, options: AgentModeOption[]): string {
  if (id === "default" || id === "creation") return t(`agentMode.${id}`);
  return options.find((o) => o.id === id)?.title ?? id;
}

export function AgentModePicker({
  t, value, options, onChange,
}: {
  t: (key: string) => string;
  value: string;
  options: AgentModeOption[];
  onChange: (v: string) => void;
}): React.JSX.Element {
  return (
    <Popover
      contentClassName="w-36 p-1"
      trigger={
        <button type="button" aria-label={t("agentMode.select")}
          className="flex items-center gap-1 rounded-full px-2 py-1 text-[11px] hover:bg-(--color-app-bubble)">
          <Bot size={13} className="shrink-0 text-(--color-app-accent)" />
          <span>{labelFor(t, value, options)}</span>
          <ChevronDown size={11} className="shrink-0" />
        </button>
      }
    >
      {options.map((o) => (
        <button key={o.id} type="button" onClick={() => onChange(o.id)}
          className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[11.5px] hover:bg-(--color-app-bubble)/60 ${o.id === value ? "text-(--color-app-accent)" : "text-(--color-app-muted)"}`}>
          <span>{labelFor(t, o.id, options)}</span>
          {o.id === value && <Check size={12} className="ml-auto shrink-0" />}
        </button>
      ))}
    </Popover>
  );
}
