// 主区顶栏（48px，参考稿胶囊簇）：侧栏开关、应用菜单弹出、任务标题 +
// 项目/路线/Git 胶囊、外部编辑器芯片、面板/终端开关与自绘窗口控制。
// 整条为拖拽区（无边框窗口），交互控件逐个 no-drag。纯 props-in/events-out。
import { useEffect, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Code,
  FolderGit2,
  GitBranch,
  MoreHorizontal,
  PanelLeft,
  PanelRight,
  SquareTerminal,
} from "lucide-react";
import { api } from "../lib/ipc";
import { zhCN } from "../lib/i18n";
import type { MenuId } from "../../../shared/ipc";
import { TitleBarWindowControls } from "./TitleBarWindowControls";

interface Props {
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  /** 当前任务/会话标题（参考稿 t-title，15px 加粗；缺省隐藏）。 */
  title?: string;
  /** Workbench view model; omitted cluster entirely when absent. */
  workbench?: {
    project: string;
    routeId: string | null;
    /** null → chip hidden (real Git detection lands with the task context wiring). */
    gitBranch: string | null;
  };
  onOpenExternalEditor?: () => void;
  panelOpen?: boolean;
  onTogglePanel?: () => void;
  terminalOpen?: boolean;
  onToggleTerminal?: () => void;
  t?: (key: string) => string;
}

const iconButton =
  "app-no-drag grid size-8 place-items-center rounded-lg text-(--color-app-muted) hover:bg-(--color-app-hover) hover:text-(--color-app-text) disabled:opacity-40";

const MENU_PANEL_ID = "titlebar-menu-panel";
const MENUS: { id: MenuId; labelKey: string; fallback: string }[] = [
  { id: "file", labelKey: "titlebar.menu.file", fallback: "文件" },
  { id: "edit", labelKey: "titlebar.menu.edit", fallback: "编辑" },
  { id: "view", labelKey: "titlebar.menu.view", fallback: "视图" },
  { id: "help", labelKey: "titlebar.menu.help", fallback: "帮助" },
];

/** 参考稿 t-pill：28px 圆角胶囊，沉底面 + 图标 + 文本。 */
const pill =
  "flex h-7 shrink-0 items-center gap-2 rounded-full bg-(--color-app-sunken) px-3.5 text-[13px] whitespace-nowrap text-(--color-app-text)";

export function TitleBar({
  sidebarOpen,
  onToggleSidebar,
  title,
  workbench,
  onOpenExternalEditor,
  panelOpen,
  onTogglePanel,
  terminalOpen,
  onToggleTerminal,
  t = (key: string): string => zhCN[key] ?? key,
}: Props): React.JSX.Element {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [menuOpen]);

  const selectMenu = (id: MenuId) => {
    setMenuOpen(false);
    void api.popupMenu(id);
  };

  const terminalLabel = terminalOpen
    ? (t("titlebar.closeTerminal") === "titlebar.closeTerminal" ? "关闭终端" : t("titlebar.closeTerminal"))
    : (t("titlebar.openTerminal") === "titlebar.openTerminal" ? "打开终端" : t("titlebar.openTerminal"));
  const terminalAction = terminalOpen ? onTogglePanel : onToggleTerminal;

  return (
    <header className="titlebar app-drag relative z-30 flex h-12 shrink-0 items-center gap-1 pl-3 text-(--color-app-muted)">
      <button
        type="button"
        onClick={onToggleSidebar}
        aria-label={sidebarOpen ? "折叠侧边栏" : "展开侧边栏"}
        aria-pressed={sidebarOpen}
        className={iconButton}
      >
        <PanelLeft size={15} />
      </button>

      <div ref={menuRef} className="app-no-drag relative">
        <button
          type="button"
          aria-label={t("titlebar.menu.open")}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          aria-controls={MENU_PANEL_ID}
          onClick={() => setMenuOpen((value) => !value)}
          className={iconButton}
        >
          <MoreHorizontal size={15} />
        </button>
        {menuOpen && (
          <div
            id={MENU_PANEL_ID}
            role="menu"
            aria-label={t("titlebar.menu.label")}
            className="card-strong pop-in absolute left-0 top-9 z-50 min-w-32 rounded-[10px] p-1"
          >
            {MENUS.map((menu) => (
              <button
                key={menu.id}
                type="button"
                role="menuitem"
                onClick={() => selectMenu(menu.id)}
                className="block w-full rounded-md px-3 py-1.5 text-left text-[13px] text-(--color-app-text) hover:bg-(--color-app-hover)"
              >
                {t(menu.labelKey) === menu.labelKey ? menu.fallback : t(menu.labelKey)}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Back/forward are stubs: this single-page app has no navigable
          history, so they stay visually present but disabled rather than
          faking a feature that does not exist. Hidden on narrow windows. */}
      <button type="button" disabled aria-label="后退" className={`${iconButton} max-[860px]:hidden`}>
        <ChevronLeft size={15} />
      </button>
      <button type="button" disabled aria-label="前进" className={`${iconButton} max-[860px]:hidden`}>
        <ChevronRight size={15} />
      </button>

      {/* 任务标题 + 状态簇：标题（加粗）→ 项目胶囊 → 路线/Git 胶囊。 */}
      {title !== undefined && title !== "" && (
        <span className="ml-2 min-w-0 truncate text-[15px] font-bold whitespace-nowrap text-(--color-app-strong)" title={title}>
          {title}
        </span>
      )}
      {workbench && (
        <div className="app-no-drag ml-2 hidden min-w-0 items-center gap-2 md:flex">
          {workbench.project !== "" && (
            <span className={`${pill} min-w-0`} title={`${t("titlebar.project")} ${workbench.project}`}>
              <FolderGit2 size={13} className="shrink-0 text-(--color-app-muted)" />
              <span className="max-w-[180px] truncate">{workbench.project}</span>
            </span>
          )}
          {workbench.routeId !== null && (
            <span className={pill} title={`${t("titlebar.route")} ${workbench.routeId}`}>
              <GitBranch size={13} className="shrink-0 text-(--color-app-muted)" />
              <span className="font-mono text-[12px]">{workbench.routeId}</span>
              <ChevronDown size={11} className="text-(--color-app-faint)" />
            </span>
          )}
          {workbench.gitBranch !== null && (
            <span className={pill} title={workbench.gitBranch}>
              <GitBranch size={13} className="shrink-0 text-(--color-app-muted)" />
              <span className="max-w-[140px] truncate font-mono text-[12px]">{workbench.gitBranch}</span>
              <ChevronDown size={11} className="text-(--color-app-faint)" />
            </span>
          )}
        </div>
      )}

      <div className="flex-1" />

      {/* 外部编辑器入口（芯片形，宿主未接线时禁用）+ 面板/终端开关。 */}
      <button
        type="button"
        aria-label={t("titlebar.externalEditor")}
        title={t("titlebar.externalEditor")}
        disabled={onOpenExternalEditor === undefined}
        onClick={onOpenExternalEditor}
        className="app-no-drag flex h-8 shrink-0 items-center gap-1 rounded-lg bg-(--color-app-sunken) px-2.5 text-(--color-app-text) hover:bg-(--color-app-hover) disabled:opacity-40"
      >
        <Code size={14} strokeWidth={1.5} />
        <ChevronDown size={11} className="text-(--color-app-faint)" />
      </button>
      {onTogglePanel && (
        <button
          type="button"
          aria-label={t("titlebar.togglePanel")}
          title={t("titlebar.togglePanel")}
          aria-pressed={panelOpen}
          onClick={onTogglePanel}
          className={iconButton}
        >
          <PanelRight size={15} />
        </button>
      )}
      {terminalAction && (
        <button
          type="button"
          aria-label={terminalLabel}
          title={terminalLabel}
          aria-pressed={terminalOpen}
          onClick={terminalAction}
          className={iconButton}
        >
          <SquareTerminal size={15} />
        </button>
      )}

      <span className="mx-1 h-6 w-px shrink-0 bg-(--color-app-hairline)" />
      <TitleBarWindowControls />
    </header>
  );
}
