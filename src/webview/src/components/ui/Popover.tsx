import * as RadixPopover from "@radix-ui/react-popover";
import type { ReactNode } from "react";

interface Props {
  trigger: ReactNode;
  children: ReactNode;
  align?: "start" | "center" | "end";
  side?: "top" | "bottom" | "left" | "right";
  contentClassName?: string;
  /** 受控开合（需要在选中/提交后主动关闭时传）。 */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

/** 弹层通用底：popup 色 + 12px 圆角 + 发丝边 + 轻阴影。 */
export function Popover({ trigger, children, align = "start", side = "top", contentClassName = "", open, onOpenChange }: Props): React.JSX.Element {
  return (
    <RadixPopover.Root open={open} onOpenChange={onOpenChange}>
      <RadixPopover.Trigger asChild>{trigger}</RadixPopover.Trigger>
      <RadixPopover.Portal>
        <RadixPopover.Content
          align={align}
          side={side}
          sideOffset={6}
          className={`dropdown-in z-50 rounded-(--radius-pop) border border-(--color-border) bg-(--color-popup) shadow-(--shadow-pop) ${contentClassName}`}
        >
          {children}
        </RadixPopover.Content>
      </RadixPopover.Portal>
    </RadixPopover.Root>
  );
}
