import * as React from "react";

// shadcn 风格 Separator：发丝线分隔。无 radix 依赖的呈现版（装饰性），
// 颜色走 token；方向用 data-orientation 表达，便于将来替换为 radix 版。
export interface SeparatorProps extends React.HTMLAttributes<HTMLDivElement> {
  orientation?: "horizontal" | "vertical";
  decorative?: boolean;
}

export const Separator = React.forwardRef<HTMLDivElement, SeparatorProps>(
  ({ orientation = "horizontal", decorative = true, className, ...props }, ref) => (
    <div
      ref={ref}
      role={decorative ? "none" : "separator"}
      aria-orientation={decorative ? undefined : orientation}
      data-orientation={orientation}
      className={[
        "shrink-0 bg-(--color-app-hairline)",
        orientation === "horizontal" ? "h-px w-full" : "h-full w-px",
        className ?? "",
      ].join(" ")}
      {...props}
    />
  ),
);
Separator.displayName = "Separator";
