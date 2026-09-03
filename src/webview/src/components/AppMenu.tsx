// 顶栏应用菜单（⌄，窗口控制左侧）：全局动作入口 —— 新建任务/打开工作区/
// 在资源管理器中打开/关于/检查更新/进程监视器/反馈类/导出日志/关闭窗口。
// 无对应能力的入口保持禁用并带原因（对齐「…」会话菜单约定）；关于/进程
// 监视器对话框由本组件自管，经 portal 挂到 body 以逃出顶栏层叠上下文。
import { useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown } from "lucide-react";
import { api, hasBridge } from "../lib/ipc";
import { DropdownMenu, DropdownMenuItem, DropdownMenuSeparator } from "./ui/DropdownMenu";
import { AboutDialog } from "./AboutDialog";
import { ProcessMonitorDialog } from "./ProcessMonitorDialog";

interface Props {
  t: (key: string) => string;
  platform?: string;
  /** 应用版本（关于对话框）；桥缺失时可缺省。 */
  version?: string;
  /** 当前工作区根（会话根或落地态选择）；空串 = 资源管理器入口禁用。 */
  workspaceRoot: string;
  onNewTask: () => void;
  onOpenWorkspace: () => void;
  /** 问题反馈外链；缺省（无桥）时该入口禁用。 */
  onFeedback?: () => void;
  onError: (message: string) => void;
}

/** 菜单项内容：左标签 + 可选右对齐快捷键提示。 */
function itemContent(label: string, kbd?: string): React.JSX.Element {
  return (
    <span className="flex w-full items-center justify-between gap-8">
      <span>{label}</span>
      {kbd && <kbd className="text-(--color-faint)">{kbd}</kbd>}
    </span>
  );
}

export function AppMenu({
  t,
  platform,
  version,
  workspaceRoot,
  onNewTask,
  onOpenWorkspace,
  onFeedback,
  onError,
}: Props): React.JSX.Element {
  const [dialog, setDialog] = useState<"about" | "procmon" | null>(null);
  const soon = t("titlebar.menu.comingSoon");
  const mod = platform === "darwin" ? "⌘" : "Ctrl+";

  const revealWorkspace = () => {
    if (!hasBridge() || workspaceRoot === "") return;
    void api.revealPath(workspaceRoot).catch(() => undefined);
  };
  const exportLogs = () => {
    if (!hasBridge()) return;
    void api
      .exportLogs()
      .then(() => undefined) // 取消或成功都静默（目录选择即反馈）
      .catch(() => onError(t("titlebar.appMenu.exportLogsFailed")));
  };
  const closeWindow = () => {
    if (hasBridge()) void api.closeWindow().catch(() => undefined);
  };

  return (
    <>
      <DropdownMenu
        align="end"
        sideOffset={4}
        contentClassName="min-w-52"
        trigger={
          <button
            type="button"
            aria-label={t("titlebar.appMenu.open")}
            title={t("titlebar.appMenu.open")}
            className="app-no-drag grid w-[46px] cursor-pointer self-stretch place-items-center text-(--color-muted) hover:bg-(--color-hover) hover:text-(--color-foreground)"
          >
            <ChevronDown size={15} strokeWidth={1.3} />
          </button>
        }
      >
        <DropdownMenuItem onSelect={onNewTask}>
          {itemContent(t("sidebar.nav.newChat"), `${mod}N`)}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onOpenWorkspace}>
          {itemContent(t("titlebar.appMenu.openWorkspace"), `${mod}O`)}
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={workspaceRoot === ""}
          description={workspaceRoot === "" ? t("titlebar.appMenu.noWorkspace") : undefined}
          onSelect={revealWorkspace}
        >
          {itemContent(t("titlebar.menu.openExplorer"))}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => setDialog("about")}>
          {itemContent(t("titlebar.appMenu.about"))}
        </DropdownMenuItem>
        <DropdownMenuItem disabled description={soon}>
          {itemContent(t("titlebar.appMenu.checkUpdates"))}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => setDialog("procmon")}>
          {itemContent(t("titlebar.appMenu.processMonitor"))}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={onFeedback === undefined} description={onFeedback === undefined ? soon : undefined} onSelect={onFeedback}>
          {itemContent(t("titlebar.menu.feedback"))}
        </DropdownMenuItem>
        <DropdownMenuItem disabled description={soon}>
          {itemContent(t("titlebar.appMenu.featureRequest"))}
        </DropdownMenuItem>
        <DropdownMenuItem disabled description={soon}>
          {itemContent(t("titlebar.appMenu.community"))}
        </DropdownMenuItem>
        <DropdownMenuItem disabled description={soon}>
          {itemContent(t("titlebar.appMenu.docs"))}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={exportLogs}>{itemContent(t("titlebar.appMenu.exportLogs"))}</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={closeWindow}>{itemContent(t("titlebar.appMenu.closeWindow"))}</DropdownMenuItem>
      </DropdownMenu>
      {dialog === "about" &&
        createPortal(<AboutDialog t={t} version={version} onClose={() => setDialog(null)} />, document.body)}
      {dialog === "procmon" &&
        createPortal(<ProcessMonitorDialog t={t} onClose={() => setDialog(null)} />, document.body)}
    </>
  );
}
