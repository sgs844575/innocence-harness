// 自定义下拉（替代原生 select）：内嵌底触发器 + popup 面板，当前项带对勾。
// 受控开合以便选中即关；面板走 dropdown-in 动效。
import { useState } from "react";
import { Popover } from "./Popover";
import { Check, ChevronDown } from "lucide-react";

export interface SelectOption {
  value: string;
  label: string;
}

export function Select({
  value,
  options,
  onChange,
  ariaLabel,
  fullWidth = false,
}: {
  value: string;
  options: readonly SelectOption[];
  onChange: (value: string) => void;
  ariaLabel: string;
  fullWidth?: boolean;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const current = options.find((option) => option.value === value);
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      side="bottom"
      align="end"
      contentClassName={`min-w-40 max-w-[var(--radix-popover-content-available-width)] p-1 ${fullWidth ? "w-[var(--radix-popover-trigger-width)]" : ""}`}
      trigger={
        <button
          type="button"
          aria-label={ariaLabel}
          title={ariaLabel}
          className={`flex h-8 min-w-36 items-center justify-between gap-2 rounded-md border border-(--color-border) bg-(--color-raised) px-2.5 text-(--color-foreground) outline-none focus-visible:border-(--color-accent) ${fullWidth ? "w-full" : ""}`}
        >
          <span className="truncate">{current?.label ?? value}</span>
          <ChevronDown size={12} className="shrink-0 text-(--color-faint)" aria-hidden />
        </button>
      }
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={option.value === value}
          onClick={() => {
            onChange(option.value);
            setOpen(false);
          }}
          className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-(--color-foreground) outline-none hover:bg-(--color-hover) focus-visible:bg-(--color-hover)"
        >
          <span className="min-w-0 flex-1 truncate">{option.label}</span>
          {option.value === value && <Check size={13} className="shrink-0 text-(--color-accent)" />}
        </button>
      ))}
    </Popover>
  );
}
