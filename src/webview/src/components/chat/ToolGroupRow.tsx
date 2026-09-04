// 工具分组行（对齐工具行视觉语言）：类别图标 + i18n 类别名 + 行数 + 常显
// chevron（分组的主操作，不做悬停显现）；点击标题区
// 或 chevron 经 .acc-panel 手风琴展开/收起（默认收起）。展开内容 = 原工具行序列（由
// ToolTimeline 以既有行渲染器渲染后作为 children 传入，运行中扫光/onOpenFile/子代理
// 行等交互不受影响）；组内有行运行中时类别名走运行中渐变文字。
import { useState } from "react";
import { ChevronRight, FileDiff, FolderSearch, SquareTerminal } from "lucide-react";
import type { ToolGroupCategory } from "./toolGrouping";

const GROUP_ICONS = {
  explore: FolderSearch,
  terminal: SquareTerminal,
  changes: FileDiff,
} as const;

const GROUP_LABEL_KEYS = {
  explore: "tool.group.explore",
  terminal: "tool.group.terminal",
  changes: "tool.group.changes",
} as const;

export function ToolGroupRow({
  category,
  t,
  count,
  running,
  children,
}: {
  category: ToolGroupCategory;
  t: (key: string) => string;
  /** 组内行数。 */
  count: number;
  /** 组内存在运行中行（类别名走渐变文字）。 */
  running: boolean;
  /** 原工具行序列（既有 ToolRow 渲染，交互原样保留）。 */
  children: React.ReactNode;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const Icon = GROUP_ICONS[category];
  const label = t(GROUP_LABEL_KEYS[category]);
  const toggle = (): void => setOpen((value) => !value);
  return (
    <div className="group/tool-group w-full">
      <div className="group/tool-summary inline-flex max-w-full items-center gap-2 self-start text-left">
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          title={`${label} (${count})`}
          className="inline-flex min-w-0 cursor-pointer items-center gap-2 transition-colors"
        >
          <Icon size={16} className="size-4 shrink-0 text-(--color-muted)" aria-hidden />
          <span
            className={`shrink-0 font-medium whitespace-nowrap ${
              running ? "animated-gradient-text" : "text-(--color-faint)"
            }`}
          >
            {label}
          </span>
          <span className="shrink-0 font-mono leading-none whitespace-nowrap tabular-nums text-(--color-faint)">{count}</span>
        </button>
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          aria-label={t(open ? "tool.group.collapse" : "tool.group.expand").replace("{name}", label)}
          title={t(open ? "tool.group.collapse" : "tool.group.expand").replace("{name}", label)}
          className="grid size-5 shrink-0 cursor-pointer place-items-center rounded text-(--color-faint) transition-colors hover:bg-(--color-hover) hover:text-(--color-foreground)"
        >
          <ChevronRight
            size={16}
            aria-hidden
            className={`size-4 transition-[transform] duration-(--duration-fast) ease-(--ease-smooth-out) motion-reduce:transition-none ${
              open ? "rotate-90" : ""
            }`}
          />
        </button>
      </div>
      <div className="acc-panel" data-open={open}>
        <div className="acc-panel-inner">
          <div className="flex flex-col gap-4 pt-2">{children}</div>
        </div>
      </div>
    </div>
  );
}
