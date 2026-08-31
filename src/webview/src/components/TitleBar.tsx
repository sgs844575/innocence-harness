// 主区顶栏（48px，参考稿 titlebar）：任务标题 → 项目/路线/Git 胶囊 →
// 更多菜单 → 右侧簇（编辑器芯片/终端/面板/分隔线/自绘窗口控制）。
// 侧栏开关与前后导航在侧栏顶部（Sidebar side-top），不在这里。
// 整条为拖拽区（无边框窗口），交互控件逐个 no-drag。纯 props-in/events-out。
import { useEffect, useRef, useState } from "react";
import {
  ChevronDown,
  Code,
  FolderGit2,
  GitBranch,
  MoreHorizontal,
  PanelRight,
  SquareTerminal,
} from "lucide-react";
import { api } from "../lib/ipc";
import { zhCN } from "../lib/i18n";
import type { MenuId } from "../../../shared/ipc";
import { TitleBarWindowControls } from "./TitleBarWindowControls";

interface Props {
  /** 当前任务/会话标题（t-title，15px 加粗；空串隐藏）。 */
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

/** 参考稿 t-pill：28px 圆角胶囊，沉底面 + 图标 + 文本，胶囊间 14px 间距。 */
const pill =
  "app-no-drag ml-3.5 flex h-7 shrink-0 items-center gap-2 rounded-full bg-(--color-app-sunken) px-3.5 text-[13px] whitespace-nowrap text-(--color-app-text)";

export function TitleBar({
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
    <header className="titlebar app-drag relative z-30 flex h-12 shrink-0 items-center pl-4 text-(--color-app-muted)">
      {/* 任务标题（t-title）+ 状态胶囊：项目 → 路线 → Git 分支。 */}
      {title !== undefined && title !== "" && (
        <span className="min-w-0 max-w-[40%] truncate text-[15px] font-bold whitespace-nowrap text-(--color-app-strong)" title={title}>
          {title}
        </span>
      )}
      {workbench && (
        <div className="app-no-drag min-[861px]:contents max-[860px]:hidden min-w-0">
          {workbench.project !== "" && (
            <span className={`${pill} min-w-0`} title={`${t("titlebar.project")} ${workbench.project}`}>
              <FolderGit2 size={14} strokeWidth={1.3} className="shrink-0 text-(--color-app-muted)" />
              <span className="max-w-[180px] truncate">{workbench.project}</span>
            </span>
          )}
          {workbench.routeId !== null && (
            <span className={pill} title={`${t("titlebar.route")} ${workbench.routeId}`}>
              <GitBranch size={14} strokeWidth={1.3} className="shrink-0 text-(--color-app-muted)" />
              <span className="font-mono text-[12px]">{workbench.routeId}</span>
              <ChevronDown size={12} className="text-(--color-app-faint)" />
            </span>
          )}
          {workbench.gitBranch !== null && (
            <span className={pill} title={workbench.gitBranch}>
              <GitBranch size={14} strokeWidth={1.3} className="shrink-0 text-(--color-app-muted)" />
              <span className="max-w-[140px] truncate font-mono text-[12px]">{workbench.gitBranch}</span>
              <ChevronDown size={12} className="text-(--color-app-faint)" />
            </span>
          )}
        </div>
      )}

      <div ref={menuRef} className="app-no-drag relative ml-4 shrink-0">
        <button
          type="button"
          aria-label={t("titlebar.menu.open")}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          aria-controls={MENU_PANEL_ID}
          onClick={() => setMenuOpen((value) => !value)}
          className={iconButton}
        >
          <MoreHorizontal size={16} />
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

      <div className="flex-1" />

      {/* 右侧簇：编辑器芯片 → 终端 → 面板 → 分隔线 → 窗口控制。 */}
      <button
        type="button"
        aria-label={t("titlebar.externalEditor")}
        title={t("titlebar.externalEditor")}
        disabled={onOpenExternalEditor === undefined}
        onClick={onOpenExternalEditor}
        className="app-no-drag mr-[2px] flex h-8 shrink-0 items-center gap-1 rounded-lg bg-(--color-app-sunken) px-2.5 text-(--color-app-text) hover:bg-(--color-app-hover) disabled:opacity-40"
      >
        <Code size={15} strokeWidth={1.5} />
        <ChevronDown size={12} className="text-(--color-app-muted)" />
      </button>
      {terminalAction && (
        <button
          type="button"
          aria-label={terminalLabel}
          title={terminalLabel}
          aria-pressed={terminalOpen}
          onClick={terminalAction}
          className={`${iconButton} ml-1`}
        >
          <SquareTerminal size={16} strokeWidth={1.3} />
        </button>
      )}
      {onTogglePanel && (
        <button
          type="button"
          aria-label={t("titlebar.togglePanel")}
          title={t("titlebar.togglePanel")}
          aria-pressed={panelOpen}
          onClick={onTogglePanel}
          className={`${iconButton} ml-1`}
        >
          <PanelRight size={16} strokeWidth={1.3} />
        </button>
      )}

      <span className="mx-1.5 h-6 w-px shrink-0 bg-(--color-app-hairline)" />
      <TitleBarWindowControls />
    </header>
  );
}
