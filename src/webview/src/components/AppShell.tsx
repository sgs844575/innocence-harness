// 应用外壳：顶栏 + 侧栏列（265px，可折叠消失）+ 主区（chat/settings/automation）。
// 视图切换与 Ctrl+K / Ctrl+N / Ctrl+O 快捷键归这里；内容节点由 App 注入。
import { useCallback, useEffect, useState } from "react";

export type ShellView = "chat" | "settings" | "automation";

export interface AppShellNav {
  view: ShellView;
  sidebarOpen: boolean;
  toggleSidebar: () => void;
  openSettings: () => void;
  openAutomation: () => void;
  backToChat: () => void;
}

interface Props {
  titleBar: (nav: AppShellNav) => React.ReactNode;
  sidebar: React.ReactNode;
  main: (nav: AppShellNav) => React.ReactNode;
  /** Ctrl+N 新建任务（App 层接线到 newSession）。 */
  onNewSession: () => void;
  /** Ctrl+K 打开搜索。 */
  onOpenSearch: () => void;
  /** Ctrl+O 打开工作区（顶栏应用菜单同款动作）；缺省 = 快捷键不生效。 */
  onOpenWorkspace?: () => void;
  /** 受控视图（缺省内部状态）；设置页/自动化页入口由 App 驱动。 */
  view?: ShellView;
  onViewChange?: (view: ShellView) => void;
  /** 右侧 dock 内容（子代理面板等）；缺省不渲染。 */
  dock?: React.ReactNode;
  /** dock 开合（宽度裁剪动画与侧栏同模式）。 */
  dockOpen?: boolean;
  /** dock 宽度（拖拽可调）；缺省 340。 */
  dockWidth?: number;
  /** 拖拽调宽期间 = 关闭宽度过渡（跟随指针，不留动画残影）。 */
  dockResizing?: boolean;
  /** 搜索对话框等浮层节点。 */
  overlay?: React.ReactNode;
  /** 错误提示 toast（4s 自动消失由 App 管理）。 */
  toast?: string | null;
}

export function AppShell({ titleBar, sidebar, main, onNewSession, onOpenSearch, onOpenWorkspace, view: controlledView, onViewChange, dock, dockOpen, dockWidth = 340, dockResizing = false, overlay, toast }: Props): React.JSX.Element {
  const [uncontrolledView, setUncontrolledView] = useState<ShellView>("chat");
  const view = controlledView ?? uncontrolledView;
  const changeView = useCallback(
    (next: ShellView) => {
      onViewChange?.(next);
      if (controlledView === undefined) setUncontrolledView(next);
    },
    [controlledView, onViewChange],
  );
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const backToChat = useCallback(() => changeView("chat"), [changeView]);
  const openSettings = useCallback(() => changeView("settings"), [changeView]);
  const openAutomation = useCallback(() => changeView("automation"), [changeView]);
  const toggleSidebar = useCallback(() => setSidebarOpen((value) => !value), []);

  const nav: AppShellNav = { view, sidebarOpen, toggleSidebar, openSettings, openAutomation, backToChat };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      const key = event.key.toLowerCase();
      if (key === "k") {
        event.preventDefault();
        onOpenSearch();
      } else if (key === "n") {
        event.preventDefault();
        backToChat();
        onNewSession();
      } else if (key === "o" && onOpenWorkspace) {
        event.preventDefault();
        onOpenWorkspace();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onNewSession, onOpenSearch, onOpenWorkspace, backToChat]);

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-(--color-sidebar) text-(--color-foreground)">
      {titleBar(nav)}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* 侧栏与页面同为灰色（无描边）；主区黑色，左缘 12px 圆角浮起。
            内层固定 265px：宽度动画只裁剪、不重排（重排会在动画中挤压文字变形）。 */}
        <div
          className={`shrink-0 overflow-hidden transition-[width] duration-(--duration-fast) ease-(--ease-smooth-out) motion-reduce:transition-none ${
            sidebarOpen ? "w-[265px]" : "w-0"
          }`}
        >
          <div className="h-full w-[265px]">{sidebar}</div>
        </div>
        <main
          className={`relative flex min-w-0 flex-1 flex-col overflow-hidden bg-(--color-background) transition-[border-radius] duration-(--duration-fast) ease-(--ease-smooth-out) motion-reduce:transition-none ${
            sidebarOpen ? "rounded-bl-[12px]" : "rounded-none"
          }`}
        >
          {main(nav)}
        </main>
        {/* 右侧 dock（子代理面板等）：与侧栏同模式——外层宽度变化只裁剪，
            内层定宽不重排；拖拽调宽期间关过渡。 */}
        {dock !== undefined && (
          <div
            style={{ width: dockOpen ? dockWidth : 0 }}
            className={`shrink-0 overflow-hidden ${
              dockResizing ? "" : "transition-[width] duration-(--duration-fast) ease-(--ease-smooth-out) motion-reduce:transition-none"
            }`}
          >
            <div className="h-full" style={{ width: dockWidth }}>{dock}</div>
          </div>
        )}
      </div>
      {overlay}
      {toast && (
        <div
          role="alert"
          className="toast-in fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-full border border-(--color-border) bg-(--color-popup) px-4 py-2 shadow-(--shadow-pop)"
        >
          {toast}
        </div>
      )}
    </div>
  );
}
