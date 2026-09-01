import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

// shadcn 风格 Badge：圆角药丸 + 语义变体；颜色全部走 token，不写死十六进制。
const badgeVariants = cva(
  [
    "inline-flex items-center gap-1 rounded-full border px-2 py-0.5",
    "whitespace-nowrap font-medium",
  ].join(" "),
  {
    variants: {
      variant: {
        default: "border-transparent bg-(--color-app-sunken) text-(--color-app-text)",
        secondary: "border-transparent bg-(--color-app-bubble) text-(--color-app-muted)",
        outline: "border-(--color-app-border) bg-transparent text-(--color-app-text)",
        success: "border-transparent bg-transparent text-(--color-diff-add)",
        destructive: "border-transparent bg-transparent text-(--color-diff-del)",
        accent: "border-transparent bg-(--color-app-accent-soft) text-(--color-app-accent)",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export const Badge = React.forwardRef<HTMLSpanElement, BadgeProps>(
  ({ className, variant, ...props }, ref) => (
    <span ref={ref} className={badgeVariants({ variant, className })} {...props} />
  ),
);
Badge.displayName = "Badge";

export { badgeVariants };
