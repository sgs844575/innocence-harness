// 窗口顶栏（48px，无边框拖拽区）：左段 logo（折叠侧栏）+ 前进/后退存根；
// 会话态显示 标题 → 项目胶囊 → 分支胶囊 → … 菜单；右端编辑器芯片 + dock 开关 +
// 应用菜单（⌄）+ 窗口控制。落地态中段留空。纯 props-in/events-out。
import { useRef, type ReactNode } from "react";
import { ArrowLeft, ArrowRight, ChevronDown, Code, FolderGit2, GitBranch, MoreHorizontal, PanelRightClose, PanelRightOpen, SquareTerminal } from "lucide-react";
import logoUrl from "../../../../logo.svg";
import { WindowControls } from "./WindowControls";

export interface TitleBarMenuItem {
  id: string;
  label: string;
  onSelect?: () => void;
  disabled?: boolean;
  /** 辅助说明（aria-description），如暂不可用的原因。 */
  description?: string;
  /** 项前渲染分隔线。 */
  separatorBefore?: boolean;
}

interface Props {
  t: (key: string) => string;
  platform?: string;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  landing: boolean;
  title?: string;
  project?: string;
  branch?: string | null;
  /** 分支胶囊位（分支面板等交互内容）；缺省渲染静态分支胶囊。 */
  branchSlot?: ReactNode;
  /** 「…」菜单项（缺省 = 按钮不渲染）。 */
  menuItems?: TitleBarMenuItem[];
  onOpenExternalEditor?: () => void;
  /** 右侧 dock（子代理面板）开关；缺省不渲染该按钮。 */
  dockOpen?: boolean;
  onToggleDock?: () => void;
  /** 顶栏终端钮：开关 dock 并直达终端标签；缺省不渲染。 */
  terminalActive?: boolean;
  onToggleTerminal?: () => void;
  /** 应用菜单（⌄）位（AppMenu 交互内容）；渲染在窗口控制左侧，缺省不渲染。 */
  appMenu?: ReactNode;
}

const pill =
  "app-no-drag ml-3 flex h-7 shrink-0 items-center gap-2 rounded-full bg-(--color-raised) px-3 whitespace-nowrap text-(--color-foreground)";

export function TitleBar({
  t,
  platform,
  sidebarOpen,
  onToggleSidebar,
  landing,
  title,
  project,
  branch,
  branchSlot,
  menuItems,
  onOpenExternalEditor,
  dockOpen,
  onToggleDock,
  terminalActive,
  onToggleTerminal,
  appMenu,
}: Props): React.JSX.Element {
  const menuRef = useRef<HTMLDetailsElement>(null);
  return (
    <header className="app-drag relative z-30 flex h-12 shrink-0 items-stretch">
      {/* 左段：侧栏展开时透明落于灰色页面（直通窗顶）；收缩时并入黑色主区，整条顶栏成一体。
          折叠宽 120px 与内容等宽（46 侧栏开关 + 16 间距 + 48 前进后退 + 10 内边距）——
          数值端点才能与下方侧栏列同 token 同步过渡（auto 不可动画，会跳变）。 */}
      <div
        className={`app-no-drag flex h-full shrink-0 items-center gap-4 pr-2.5 transition-[width,background-color] duration-(--duration-fast) ease-(--ease-smooth-out) motion-reduce:transition-none ${
          sidebarOpen ? "w-[265px]" : "w-[120px] bg-(--color-background)"
        }`}
      >
        {/* 侧栏开关：与窗口控制同规格的全高 46px 命中区，贴左缘。 */}
        <button
          type="button"
          onClick={onToggleSidebar}
          aria-label={sidebarOpen ? t("sidebar.close") : t("sidebar.open")}
          aria-pressed={sidebarOpen}
          title={sidebarOpen ? t("sidebar.close") : t("sidebar.open")}
          className="grid w-[46px] shrink-0 self-stretch place-items-center hover:bg-(--color-hover)"
        >
          <img src={logoUrl} alt="" className="size-[15px] rounded-[3px]" />
        </button>
        <div className="flex items-center gap-[18px]">
          <button type="button" disabled aria-label={t("titlebar.back")} title={t("titlebar.back")} className="text-(--color-muted) disabled:opacity-60">
            <ArrowLeft size={15} strokeWidth={1.3} />
          </button>
          <button type="button" disabled aria-label={t("titlebar.forward")} title={t("titlebar.forward")} className="text-(--color-faint)">
            <ArrowRight size={15} strokeWidth={1.3} />
          </button>
        </div>
      </div>

      {/* 右段：黑色主区的一部分（与 main 连成一体），侧栏展开时左上 12px 圆角。 */}
      <div
        className={`flex min-w-0 flex-1 items-center bg-(--color-background) transition-[border-radius] duration-200 ease-out motion-reduce:transition-none ${
          sidebarOpen ? "rounded-tl-[12px]" : "rounded-none"
        }`}
      >
      {!landing && (
        <div className="app-no-drag flex min-w-0 items-center pl-4">
          {title && (
            <span className="min-w-0 max-w-[40%] truncate font-bold whitespace-nowrap text-(--color-foreground-strong)" title={title}>
              {title}
            </span>
          )}
          {project && (
            /* 项目胶囊：静态展示（无下拉箭头），文字在胶囊内上下左右居中。 */
            <span className={`${pill} min-w-0 justify-center`} title={`${t("titlebar.project")} ${project}`}>
              <FolderGit2 size={14} strokeWidth={1.3} className="shrink-0 text-(--color-muted)" />
              <span className="max-w-[180px] truncate text-center leading-7">{project}</span>
            </span>
          )}
          {branchSlot ??
            (branch && (
              <span className={pill} title={branch}>
                <GitBranch size={14} strokeWidth={1.3} className="shrink-0 text-(--color-muted)" />
                <span className="max-w-[140px] truncate font-mono">{branch}</span>
                <ChevronDown size={12} className="text-(--color-faint)" />
              </span>
            ))}
          {menuItems && menuItems.length > 0 && (
            <details ref={menuRef} className="relative ml-2 shrink-0">
              <summary
                aria-label={t("titlebar.menu.open")}
                title={t("titlebar.menu.open")}
                className="grid size-8 cursor-pointer list-none place-items-center rounded-lg text-(--color-muted) hover:bg-(--color-hover) hover:text-(--color-foreground) [&::-webkit-details-marker]:hidden"
              >
                <MoreHorizontal size={16} />
              </summary>
              <div role="menu" data-state="open" className="dropdown-in origin-top-left absolute left-0 top-9 z-50 min-w-44 rounded-(--radius-pop) border border-(--color-border) bg-(--color-popup) p-1 shadow-(--shadow-pop)">
                {menuItems.map((item) => (
                  <div key={item.id}>
                    {item.separatorBefore && <div className="mx-1 my-1 h-px bg-(--color-hairline)" role="separator" />}
                    <button
                      type="button"
                      role="menuitem"
                      disabled={item.disabled}
                      aria-description={item.description}
                      title={item.disabled ? item.description : undefined}
                      onClick={() => {
                        menuRef.current?.removeAttribute("open");
                        item.onSelect?.();
                      }}
                      className="block w-full rounded-md px-3 py-1.5 text-left text-(--color-foreground) hover:bg-(--color-hover) disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:bg-transparent"
                    >
                      {item.label}
                    </button>
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>
      )}

      <div className="flex-1" />

      {/* 右簇：编辑器芯片（未配置时禁用）+ dock 开关（会话态）+ 自绘窗口控制。 */}
      <button
        type="button"
        aria-label={t("titlebar.externalEditor")}
        title={t("titlebar.externalEditor")}
        disabled={onOpenExternalEditor === undefined}
        onClick={onOpenExternalEditor}
        className="app-no-drag mr-2 flex h-8 shrink-0 items-center gap-1 rounded-lg bg-(--color-raised) px-2.5 text-(--color-foreground) hover:bg-(--color-hover) disabled:opacity-40"
      >
        <Code size={15} strokeWidth={1.5} />
        <ChevronDown size={12} className="text-(--color-muted)" />
      </button>
      {!landing && onToggleTerminal && (
        <button
          type="button"
          onClick={onToggleTerminal}
          aria-label={t("titlebar.terminal")}
          aria-pressed={terminalActive === true}
          title={t("titlebar.terminal")}
          className={`app-no-drag mr-2 grid size-8 shrink-0 place-items-center rounded-lg hover:bg-(--color-hover) ${
            terminalActive ? "bg-(--color-selected) text-(--color-foreground)" : "text-(--color-muted) hover:text-(--color-foreground)"
          }`}
        >
          <SquareTerminal size={15} strokeWidth={1.5} />
        </button>
      )}
      {!landing && onToggleDock && (
        <button
          type="button"
          onClick={onToggleDock}
          aria-label={t("titlebar.dock")}
          aria-pressed={dockOpen === true}
          title={t("titlebar.dock")}
          className={`app-no-drag mr-2 grid size-8 shrink-0 place-items-center rounded-lg hover:bg-(--color-hover) ${
            dockOpen ? "bg-(--color-selected) text-(--color-foreground)" : "text-(--color-muted) hover:text-(--color-foreground)"
          }`}
        >
          {/* 参考形态：关 = PanelRightOpen（展开），开 = PanelRightClose（收合）。 */}
          {dockOpen ? (
            <PanelRightClose size={15} strokeWidth={1.5} />
          ) : (
            <PanelRightOpen size={15} strokeWidth={1.5} />
          )}
        </button>
      )}
      {appMenu}
      <WindowControls platform={platform} />
      </div>
    </header>
  );
}
