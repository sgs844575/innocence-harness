// 窗口顶栏（48px，独立于侧边栏）：左段 265px 收纳 logo（点击折叠/展开
// 侧边栏——收起时侧边栏整体消失而非缩成窄条）、前进/后退存根箭头，以及
// 仅在收起态出现的新会话快捷钮；左段背景色随侧边栏显隐在侧栏色/主区色间
// 切换，使侧边栏在展开时视觉上直通窗口顶。右段：任务标题 → 项目/路线/Git
// 胶囊 → 更多菜单 → 编辑器芯片/终端/面板/分隔线/自绘窗口控制。
// 整条为拖拽区（无边框窗口），交互控件逐个 no-drag。纯 props-in/events-out。
import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  ChevronDown,
  Code,
  FolderGit2,
  GitBranch,
  GitFork,
  MoreHorizontal,
  PanelRight,
  SquarePlus,
  SquareTerminal,
} from "lucide-react";
import logoUrl from "../../../../logo.svg";
import { api } from "../lib/ipc";
import { zhCN } from "../lib/i18n";
import type { MenuId } from "../../../shared/ipc";
import { TitleBarWindowControls } from "./TitleBarWindowControls";

interface Props {
  /** 侧边栏当前是否可见（宽屏=显隐；窄屏=抽屉开合），驱动左段底色与新会话钮。 */
  sidebarOpen: boolean;
  /** logo 点击：折叠/展开侧边栏。缺省时 logo 为静态芯片。 */
  onToggleSidebar?: () => void;
  /** 收起态左段的新会话快捷钮（展开时侧栏菜单已有同项，故隐藏）。 */
  onNewSession?: () => void;
  /** 落地态（新会话、无激活会话）：隐藏更多菜单（"…"三点）。 */
  landing?: boolean;
  /** 当前任务/会话标题（t-title，14px 加粗；空串隐藏）。 */
  title?: string;
  /** Workbench view model; omitted cluster entirely when absent. */
  workbench?: {
    project: string;
    /** 分叉路线 id；主路线传 null（与 Git 分支胶囊同值同图标会像重复分支）。 */
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
  "app-no-drag ml-3.5 flex h-7 shrink-0 items-center gap-2 rounded-full bg-(--color-app-sunken) px-3.5 whitespace-nowrap text-(--color-app-text)";

export function TitleBar({
  sidebarOpen,
  onToggleSidebar,
  onNewSession,
  landing = false,
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
    <header className="titlebar app-drag relative z-30 flex h-12 shrink-0 items-center">
      {/* 左段：logo（折叠/展开）+ 导航箭头存根 + 收起态新会话钮。
          段宽与背景色随侧栏显隐动画（展开=侧栏色直通窗顶，收起=透明露出主区色）。 */}
      <div
        className={`app-no-drag flex h-full shrink-0 items-center gap-4 pl-3 pr-2.5 transition-[width,background-color] duration-200 ease-out ${
          sidebarOpen ? "w-[265px] bg-(--color-app-sidebar)" : "w-[142px] bg-transparent"
        }`}
      >
        {/* logo 芯片：展开态挖孔页面底色，收起态沉底面（背景随侧栏显隐过渡）。 */}
        {onToggleSidebar ? (
          <button
            type="button"
            onClick={onToggleSidebar}
            aria-label={sidebarOpen ? "折叠侧边栏" : "展开侧边栏"}
            aria-pressed={sidebarOpen}
            title={sidebarOpen ? "折叠侧边栏" : "展开侧边栏"}
            className={`grid size-[23px] shrink-0 place-items-center rounded-md transition-[width,background-color] duration-200 ease-out ${
              sidebarOpen ? "bg-(--color-app-bg)" : "bg-(--color-app-sunken)"
            } hover:opacity-80`}
          >
            <img src={logoUrl} alt="" className="size-[15px] rounded-[3px]" />
          </button>
        ) : (
          <div className="grid size-[23px] shrink-0 place-items-center rounded-md bg-(--color-app-bg)">
            <img src={logoUrl} alt="" className="size-[15px] rounded-[3px]" />
          </div>
        )}
        <div className="app-no-drag flex items-center gap-[18px]">
          <button type="button" disabled aria-label="后退" title="后退" className="text-(--color-app-muted) disabled:opacity-60"><ArrowLeft size={15} strokeWidth={1.3} /></button>
          <button type="button" disabled aria-label="前进" title="前进" className="text-(--color-app-faint)"><ArrowRight size={15} strokeWidth={1.3} /></button>
          {!sidebarOpen && onNewSession && (
            <button type="button" onClick={onNewSession} aria-label="新会话" title={t("sidebar.nav.newChat")} className="pop-in text-(--color-app-muted) hover:text-(--color-app-text)"><SquarePlus size={15} strokeWidth={1.3} /></button>
          )}
        </div>
      </div>

      {/* 任务标题（t-title）+ 状态胶囊：项目 →（分叉路线，GitFork 图标）→ Git 分支。
          pl-4 与左段（侧栏）保持距离；收起时左段收窄，标题随之左对齐。 */}
      <div className="app-no-drag flex min-w-0 items-center pl-4">
        {title !== undefined && title !== "" && (
          <span className="min-w-0 max-w-[40%] truncate font-bold whitespace-nowrap text-(--color-app-strong)" title={title}>
            {title}
          </span>
        )}
        {workbench && (
          <div className="flex min-w-0 items-center max-[860px]:hidden">
            {workbench.project !== "" && (
              <span className={`${pill} min-w-0`} title={`${t("titlebar.project")} ${workbench.project}`}>
                <FolderGit2 size={14} strokeWidth={1.3} className="shrink-0 text-(--color-app-muted)" />
                <span className="max-w-[180px] truncate">{workbench.project}</span>
              </span>
            )}
            {workbench.routeId !== null && (
              <span className={pill} title={`${t("titlebar.route")} ${workbench.routeId}`}>
                <GitFork size={14} strokeWidth={1.3} className="shrink-0 text-(--color-app-muted)" />
                <span className="font-mono ">{workbench.routeId}</span>
                <ChevronDown size={12} className="text-(--color-app-faint)" />
              </span>
            )}
            {workbench.gitBranch !== null && (
              <span className={pill} title={workbench.gitBranch}>
                <GitBranch size={14} strokeWidth={1.3} className="shrink-0 text-(--color-app-muted)" />
                <span className="max-w-[140px] truncate font-mono ">{workbench.gitBranch}</span>
                <ChevronDown size={12} className="text-(--color-app-faint)" />
              </span>
            )}
          </div>
        )}
      </div>

      {!landing && (
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
            className="card-strong pop-in absolute left-0 top-9 z-50 min-w-32 p-1"
          >
            {MENUS.map((menu) => (
              <button
                key={menu.id}
                type="button"
                role="menuitem"
                onClick={() => selectMenu(menu.id)}
                className="block w-full rounded-md px-3 py-1.5 text-left text-(--color-app-text) hover:bg-(--color-app-hover)"
              >
                {t(menu.labelKey) === menu.labelKey ? menu.fallback : t(menu.labelKey)}
              </button>
            ))}
          </div>
        )}
      </div>
      )}

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
