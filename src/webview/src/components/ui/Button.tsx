import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

// 项目内尚无 cn/clsx 工具；cva 已返回 className 字符串，
// 与现有 ui/Popover.tsx 用模板拼接的风格一致。空值过滤防 "undefined" 入类。
function cn(...classes: Array<string | undefined | false | null>): string {
  return classes.filter(Boolean).join(" ");
}

const buttonVariants = cva(
  [
    "inline-flex items-center justify-center gap-1.5",
    "rounded-[var(--radius-pop)] font-medium whitespace-nowrap",
    "transition-colors focus-visible:outline-none focus-visible:ring-2",
    "focus-visible:ring-(--color-app-accent) focus-visible:ring-offset-1",
    "focus-visible:ring-offset-(--color-app-panel)",
    "disabled:pointer-events-none disabled:opacity-50",
  ].join(" "),
  {
    variants: {
      variant: {
        default:    "bg-(--color-app-strong) text-(--color-app-panel) hover:bg-(--color-app-text)",
        destructive:"bg-(--color-diff-del) text-white hover:opacity-90",
        outline:    "border border-(--color-app-border) bg-transparent hover:bg-(--color-app-hover)",
        secondary:  "bg-(--color-app-raised) text-(--color-app-text) hover:bg-(--color-app-hover)",
        ghost:      "bg-transparent text-(--color-app-muted) hover:bg-(--color-app-hover) hover:text-(--color-app-text)",
      },
      size: {
        default: "h-8 px-3",
        sm:      "h-7 px-2 ",
        lg:      "h-9 px-4",
        icon:    "size-7 p-0",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => (
    <button
      ref={ref}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  )
);
Button.displayName = "Button";

export { buttonVariants };
