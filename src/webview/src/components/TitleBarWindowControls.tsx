// 自绘窗口控制（Win/Linux 无边框标题栏）：最小化 / 最大化-还原 / 关闭。
// macOS 不渲染（hiddenInset 下系统红绿灯仍由系统绘制）。预加载桥缺失
// （纯浏览器/测试渲染）时静默降级为无操作按钮。
import { useEffect, useState } from "react";
import { Minus, Square, X } from "lucide-react";
import { api } from "../lib/ipc";

const isDarwin = navigator.userAgent.includes("Mac");

const controlButton =
  "app-no-drag grid h-full w-11 place-items-center text-(--color-app-text) transition-colors";

export function TitleBarWindowControls(): React.JSX.Element | null {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (isDarwin) return;
    let off: (() => void) | undefined;
    try {
      void api.isWindowMaximized().then((value) => setMaximized(value));
      off = api.onWindowMaximizedChanged((value) => setMaximized(value));
    } catch {
      // preload 桥缺失：控制钮保留视觉但不可用（开发用浏览器直开等场景）。
    }
    return () => off?.();
  }, []);

  if (isDarwin) return null;

  const call = (action: () => Promise<unknown>): void => {
    try {
      void action();
    } catch {
      // 同上：桥缺失时忽略。
    }
  };

  return (
    <div className="app-no-drag ml-1.5 flex h-full shrink-0">
      <button
        type="button"
        aria-label="最小化"
        title="最小化"
        onClick={() => call(() => api.minimizeWindow())}
        className={`${controlButton} hover:bg-(--color-app-hover)`}
      >
        <Minus size={11} strokeWidth={1.4} />
      </button>
      <button
        type="button"
        aria-label={maximized ? "还原" : "最大化"}
        title={maximized ? "还原" : "最大化"}
        onClick={() => call(() => api.toggleMaximizeWindow())}
        className={`${controlButton} hover:bg-(--color-app-hover)`}
      >
        {maximized ? (
          <span className="relative block size-[11px]">
            <span className="absolute bottom-0 left-0 block size-[7.5px] rounded-px border border-current" />
            <span className="absolute right-0 top-0 block size-[7.5px] rounded-px border border-current bg-(--color-app-panel)" />
          </span>
        ) : (
          <Square size={10} strokeWidth={1.4} />
        )}
      </button>
      <button
        type="button"
        aria-label="关闭"
        title="关闭"
        onClick={() => call(() => api.closeWindow())}
        className={`${controlButton} hover:bg-[#c42b1c] hover:text-white`}
      >
        <X size={13} strokeWidth={1.4} />
      </button>
    </div>
  );
}
