import * as RadixDialog from "@radix-ui/react-dialog";
import type { ReactNode } from "react";

export function Dialog({
  open,
  onOpenChange,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}): React.JSX.Element {
  return <RadixDialog.Root open={open} onOpenChange={onOpenChange}>{children}</RadixDialog.Root>;
}

export const DialogPortal = RadixDialog.Portal;
export const DialogOverlay = RadixDialog.Overlay;
export const DialogContent = RadixDialog.Content;
export const DialogTitle = RadixDialog.Title;
