import * as RadixDropdownMenu from "@radix-ui/react-dropdown-menu";
import type { ReactNode } from "react";

export function DropdownMenu({
  trigger,
  children,
}: {
  trigger: ReactNode;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <RadixDropdownMenu.Root>
      <RadixDropdownMenu.Trigger asChild>{trigger}</RadixDropdownMenu.Trigger>
      <RadixDropdownMenu.Portal>
        <RadixDropdownMenu.Content className="pop-in z-50 min-w-32 rounded-(--radius-pop) border border-(--color-app-border) bg-(--color-app-raised) p-1 shadow-(--shadow-pop)">
          {children}
        </RadixDropdownMenu.Content>
      </RadixDropdownMenu.Portal>
    </RadixDropdownMenu.Root>
  );
}

export function DropdownMenuItem({ children, onSelect }: { children: ReactNode; onSelect: () => void }): React.JSX.Element {
  return (
    <RadixDropdownMenu.Item
      onSelect={onSelect}
      className="cursor-pointer rounded px-2.5 py-1.5 text-[12px] outline-none hover:bg-(--color-app-bubble) focus:bg-(--color-app-bubble)"
    >
      {children}
    </RadixDropdownMenu.Item>
  );
}
