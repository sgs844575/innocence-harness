import * as RadixDropdownMenu from "@radix-ui/react-dropdown-menu";
import type { ReactNode } from "react";

const contentClass =
  "dropdown-in z-50 min-w-32 rounded-(--radius-pop) border border-(--color-border) bg-(--color-popup) p-1 shadow-(--shadow-pop)";

export function DropdownMenu({
  trigger,
  children,
  contentClassName = "",
  align,
  sideOffset,
}: {
  trigger: ReactNode;
  children: ReactNode;
  contentClassName?: string;
  /** 对齐触发器的方式（右缘触发器传 "end" 防溢出）。 */
  align?: "start" | "center" | "end";
  sideOffset?: number;
}): React.JSX.Element {
  return (
    <RadixDropdownMenu.Root>
      <RadixDropdownMenu.Trigger asChild>{trigger}</RadixDropdownMenu.Trigger>
      <RadixDropdownMenu.Portal>
        <RadixDropdownMenu.Content align={align} sideOffset={sideOffset} className={`${contentClass} ${contentClassName}`}>
          {children}
        </RadixDropdownMenu.Content>
      </RadixDropdownMenu.Portal>
    </RadixDropdownMenu.Root>
  );
}

export function DropdownMenuItem({
  children,
  onSelect,
  disabled,
  description,
}: {
  children: ReactNode;
  onSelect?: () => void;
  disabled?: boolean;
  /** 辅助说明（aria-description），如能力暂不可用的原因。 */
  description?: string;
}): React.JSX.Element {
  return (
    <RadixDropdownMenu.Item
      onSelect={onSelect}
      disabled={disabled}
      aria-description={description}
      className="cursor-pointer rounded px-2.5 py-1.5 outline-none data-[disabled]:cursor-not-allowed data-[disabled]:opacity-45 hover:bg-(--color-hover) focus:bg-(--color-hover) data-[disabled]:hover:bg-transparent"
    >
      {children}
    </RadixDropdownMenu.Item>
  );
}

/** 二级子菜单（厂家 → 模型级联列表）；子面板限高自滚动，防长列表溢出。
 *  可受控（open/onOpenChange）：调用方需要「点击也展开」的确定行为时使用。 */
export function DropdownMenuSub({
  trigger,
  children,
  contentClassName = "",
  open,
  onOpenChange,
}: {
  trigger: ReactNode;
  children: ReactNode;
  contentClassName?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}): React.JSX.Element {
  return (
    <RadixDropdownMenu.Sub open={open} onOpenChange={onOpenChange}>
      <RadixDropdownMenu.SubTrigger className="flex cursor-pointer items-center rounded px-2.5 py-1.5 outline-none hover:bg-(--color-hover) focus:bg-(--color-hover) data-[state=open]:bg-(--color-hover)">
        {trigger}
      </RadixDropdownMenu.SubTrigger>
      <RadixDropdownMenu.Portal>
        <RadixDropdownMenu.SubContent sideOffset={4} className={`${contentClass} ${contentClassName}`}>
          {children}
        </RadixDropdownMenu.SubContent>
      </RadixDropdownMenu.Portal>
    </RadixDropdownMenu.Sub>
  );
}

export function DropdownMenuSeparator(): React.JSX.Element {
  return <RadixDropdownMenu.Separator className="mx-1 my-1 h-px bg-(--color-hairline)" />;
}
