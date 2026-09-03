import { BrainCircuit, Check, ChevronDown } from "lucide-react";
import { Popover } from "../ui/Popover";

export type EffortValue = "" | "off" | "low" | "medium" | "high" | "max";

/** 三档菜单（对齐参考界面）：低 / 高 / 最高；后端 reasoningEffort 取 low/high/max。 */
const OPTIONS: { value: EffortValue; key: string }[] = [
  { value: "low", key: "reasoning.effort.low" },
  { value: "high", key: "reasoning.effort.high" },
  { value: "max", key: "reasoning.effort.max" },
];

/** 思考强度下拉：低/高/最高三档，选中项带对勾。
 *  存量设置值（默认/关闭/中）不在菜单内时，chip 仍按原档位文案显示。 */
export function ThinkingEffortPicker({
  t,
  value,
  onChange,
}: {
  t: (key: string) => string;
  value: EffortValue;
  onChange: (v: EffortValue) => void;
}): React.JSX.Element {
  const label = t(`reasoning.effort.${value === "" ? "default" : value}`);
  return (
    <Popover
      contentClassName="w-32 p-1"
      trigger={
        <button
          type="button"
          aria-label={t("reasoning.effort")}
          title={t("reasoning.effort")}
          data-thinking-label={label}
          className="flex items-center gap-1.5 rounded-md px-1.5 py-1 text-(--color-foreground) outline-none hover:bg-(--color-hover)"
        >
          <BrainCircuit size={14} className="shrink-0 text-(--color-muted)" />
          <span>{label}</span>
          <ChevronDown size={11} className="shrink-0 text-(--color-faint)" />
        </button>
      }
    >
      {OPTIONS.map(({ value: v, key }) => (
        <button
          key={v}
          type="button"
          onClick={() => onChange(v)}
          className={`flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left hover:bg-(--color-hover) ${
            v === value ? "text-(--color-foreground)" : "text-(--color-muted)"
          }`}
        >
          <span>{t(key)}</span>
          {v === value && <Check size={12} className="ml-auto shrink-0 text-(--color-accent)" />}
        </button>
      ))}
    </Popover>
  );
}
