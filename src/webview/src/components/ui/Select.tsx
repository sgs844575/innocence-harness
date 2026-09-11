// 自定义下拉（替代原生 select）：内嵌底触发器 + popup 面板，当前项带对勾。
// 受控开合以便选中即关；面板走 dropdown-in 动效。
import { Fragment, useState, type ReactNode } from "react";
import { Popover } from "./Popover";
import { Check, ChevronDown } from "lucide-react";

export interface SelectOption {
  value: string;
  label: string;
  icon?: ReactNode;
  group?: string;
}

export function Select({
  value,
  options,
  onChange,
  ariaLabel,
  fullWidth = false,
  icon,
  pill = false,
  popupLabel,
  iconOnly = false,
  disabled = false,
  onOpenChange,
  footer,
  widePopup = false,
}: {
  value: string;
  options: readonly SelectOption[];
  onChange: (value: string) => void;
  ariaLabel: string;
  fullWidth?: boolean;
  icon?: ReactNode;
  pill?: boolean;
  popupLabel?: string;
  /** Compact selector used beside a separate primary action. */
  iconOnly?: boolean;
  disabled?: boolean;
  onOpenChange?: (open: boolean) => void;
  footer?: ReactNode | ((close: () => void) => ReactNode);
  widePopup?: boolean;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const current = options.find((option) => option.value === value);
  return (
    <Popover
      open={open}
      onOpenChange={(next) => { setOpen(next); onOpenChange?.(next); }}
      side="bottom"
      align={pill ? "start" : "end"}
      contentClassName={`scrollbar-thin max-h-[min(480px,var(--radix-popover-content-available-height))] overflow-y-auto ${widePopup ? "min-w-64" : "min-w-40"} max-w-[var(--radix-popover-content-available-width)] p-1 ${fullWidth ? "w-[var(--radix-popover-trigger-width)]" : ""}`}
      trigger={
        <button
          type="button"
          disabled={disabled}
          aria-label={ariaLabel}
          title={ariaLabel}
          className={iconOnly ? "grid h-7 w-5 shrink-0 place-items-center rounded-r-lg text-(--color-muted) hover:bg-(--color-hover) focus-visible:outline-2 focus-visible:outline-(--color-accent) disabled:opacity-45" : `flex h-8 min-w-0 items-center justify-between gap-2 border border-(--color-border) bg-(--color-surface) px-2.5 text-(--color-foreground) outline-none focus-visible:border-(--color-accent) ${pill ? "max-w-64 rounded-(--radius-pill)" : "min-w-36 rounded-md"} ${fullWidth ? "w-full" : ""}`}
        >
          {!iconOnly && icon && <span className="shrink-0 text-(--color-muted)" aria-hidden>{icon}</span>}
          {!iconOnly && <span className="truncate">{current?.label ?? value}</span>}
          <ChevronDown size={12} className="shrink-0 text-(--color-faint)" aria-hidden />
        </button>
      }
    >
      {popupLabel && <div className="px-2.5 py-1.5 text-(--color-faint)">{popupLabel}</div>}
      {options.map((option, index) => <Fragment key={option.value}>
        {option.group && option.group !== options[index - 1]?.group && <div className="mt-1 border-t border-(--color-border) px-2.5 pt-3 pb-1 text-(--color-faint)">{option.group}</div>}
        <button
          key={option.value}
          type="button"
          disabled={disabled}
          aria-pressed={option.value === value}
          title={option.value}
          onClick={() => {
            onChange(option.value);
            setOpen(false);
            onOpenChange?.(false);
          }}
          className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-(--color-foreground) outline-none hover:bg-(--color-hover) focus-visible:bg-(--color-hover)"
        >
          {(option.icon ?? icon) && <span className="shrink-0 text-(--color-muted)" aria-hidden>{option.icon ?? icon}</span>}
          <span className="min-w-0 flex-1 truncate">{option.label}</span>
          {option.value === value && <Check size={13} className="shrink-0 text-(--color-accent)" />}
        </button>
      </Fragment>)}
      {typeof footer === "function" ? footer(() => { setOpen(false); onOpenChange?.(false); }) : footer}
    </Popover>
  );
}
