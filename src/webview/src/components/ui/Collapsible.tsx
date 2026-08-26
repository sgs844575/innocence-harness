import * as RadixCollapsible from "@radix-ui/react-collapsible";
import type { ReactNode } from "react";

export function Collapsible({
  open,
  onOpenChange,
  trigger,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trigger: ReactNode;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <RadixCollapsible.Root open={open} onOpenChange={onOpenChange}>
      <RadixCollapsible.Trigger asChild>{trigger}</RadixCollapsible.Trigger>
      <RadixCollapsible.Content>{children}</RadixCollapsible.Content>
    </RadixCollapsible.Root>
  );
}
