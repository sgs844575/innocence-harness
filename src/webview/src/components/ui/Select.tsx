// 自定义下拉（替代原生 select）：内嵌底触发器 + popup 面板，当前项带对勾。
// 受控开合以便选中即关；面板走 dropdown-in 动效。
import { useState } from "react";
import * as RadixPopover from "@radix-ui/react-popover";
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
}: {
  value: string;
  options: readonly SelectOption[];
  onChange: (value: string) => void;
  ariaLabel: string;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const current = options.find((option) => option.value === value);
  return (
    <RadixPopover.Root open={open} onOpenChange={setOpen}>
      <RadixPopover.Trigger asChild>
        <button
          type="button"
          aria-label={ariaLabel}
          title={ariaLabel}
          className="flex h-8 min-w-36 items-center justify-between gap-2 rounded-md border border-(--color-border) bg-(--color-surface) px-2.5 text-(--color-foreground) outline-none"
        >
          <span className="truncate">{current?.label ?? value}</span>
          <ChevronDown size={12} className="shrink-0 text-(--color-faint)" aria-hidden />
        </button>
      </RadixPopover.Trigger>
      <RadixPopover.Portal>
        <RadixPopover.Content
          side="bottom"
          align="end"
          sideOffset={6}
          className="dropdown-in z-50 min-w-40 rounded-(--radius-pop) border border-(--color-border) bg-(--color-popup) p-1 shadow-(--shadow-pop)"
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
              className="flex w-full items-center gap-2 rounded px-2.5 py-1.5 text-left text-(--color-foreground) hover:bg-(--color-hover)"
            >
              <span className="min-w-0 flex-1 truncate">{option.label}</span>
              {option.value === value && <Check size={13} className="shrink-0 text-(--color-accent)" />}
            </button>
          ))}
        </RadixPopover.Content>
      </RadixPopover.Portal>
    </RadixPopover.Root>
  );
}
