import { Minus, Square, X } from "lucide-react";
import { api, hasBridge } from "../lib/ipc";

/** 自绘窗口控制（Win/Linux 无边框）：46×36 命中区，关闭悬停红。macOS 用系统灯。 */
export function WindowControls({ platform }: { platform?: string }): React.JSX.Element | null {
  if (platform === "darwin") return null;
  const invoke = (fn: () => Promise<void>) => () => {
    if (hasBridge()) void fn().catch(() => undefined);
  };
  return (
    <div className="app-no-drag ml-auto flex items-stretch self-stretch">
      <button
        type="button"
        aria-label="最小化"
        title="最小化"
        onClick={invoke(() => api.minimizeWindow())}
        className="grid w-[46px] place-items-center text-(--color-muted) hover:bg-(--color-hover)"
      >
        <Minus size={15} strokeWidth={1.3} />
      </button>
      <button
        type="button"
        aria-label="最大化或还原"
        title="最大化或还原"
        onClick={invoke(() => api.toggleMaximizeWindow())}
        className="grid w-[46px] place-items-center text-(--color-muted) hover:bg-(--color-hover)"
      >
        <Square size={13} strokeWidth={1.3} />
      </button>
      <button
        type="button"
        aria-label="关闭"
        title="关闭"
        onClick={invoke(() => api.closeWindow())}
        className="grid w-[46px] place-items-center text-(--color-muted) hover:bg-[#e81123] hover:text-white"
      >
        <X size={16} strokeWidth={1.3} />
      </button>
    </div>
  );
}
