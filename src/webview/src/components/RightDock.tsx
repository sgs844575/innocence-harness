// 右侧 dock：标签式面板。无标签 = 「打开标签页」首页（功能格 + 占位格）。
// 标签条（对齐参考形态）：ˇ 弹出「打开的标签页」列表（搜索 + 相对时间 + 逐个
// 关闭），标签 chip 横排，＋ 弹出标签类型菜单（辅助对话/子代理可用，其余占位
// 禁用）。「子代理」标签内是 列表 ↔ 对话 双视图；「辅助对话」标签内容经
// renderAuxTab 由 App 注入（AuxChatView）；「文件」标签由时间线文件行点开，
// 展示该次调用的修改内容或原文。左缘拖拽把手改宽度。
import { useState } from "react";
import * as RadixPopover from "@radix-ui/react-popover";
import {
  Bot,
  ChevronDown,
  FileSearch,
  FileText,
  Globe,
  MessagesSquare,
  Plus,
  Search,
  SquareTerminal,
  X,
} from "lucide-react";
import type { SubagentRun } from "../state/subagentRuns";
import {
  dockTabTitle,
  relativeTabTime,
  type DockTabInstance,
  type DockTabKind,
} from "../state/dockTabs";
import { isRunning, RunConversation, SubagentsList } from "./dock/SubagentsView";
import { DiffBlock } from "./chat/ToolRow";
import type { CodeAppearance } from "./chat/MarkdownView";

// 类型经本文件再导出（type-only，不影响 Fast Refresh）；运行时工具函数见
// state/dockTabs.ts（组件文件混出运行时会破坏 vite Fast Refresh）。
export type { DockTabInstance, DockTabKind } from "../state/dockTabs";

interface Props {
  t: (key: string) => string;
  tabs: DockTabInstance[];
  /** null = 「打开标签页」首页。 */
  activeTabId: string | null;
  onActivateTab: (id: string) => void;
  onCloseTab: (id: string) => void;
  onNewTab: (kind: DockTabKind) => void;
  /** 「子代理」标签：运行列表数据与对话定位。 */
  runs: SubagentRun[];
  selectedChildId?: string | null;
  onSelect?: (childId: string | null) => void;
  /** 「辅助对话」标签内容（App 注入 AuxChatView，持有 settings 等装配）。 */
  renderAuxTab: (tab: DockTabInstance) => React.ReactNode;
  /** 「审查」标签内容（App 注入 ReviewView，持有 workspaceRoot 与刷新信号）。 */
  renderReviewTab: () => React.ReactNode;
  /** 「终端」标签内容（App 注入 DockTerminalView，持有 workspaceRoot/字号）。 */
  renderTerminalTab: (tab: DockTabInstance) => React.ReactNode;
  /** 「浏览器」标签内容（App 注入 BrowserView，标题回写经 onTitleChange）。 */
  renderBrowserTab: (tab: DockTabInstance) => React.ReactNode;
  /** 代码外观（外观设置）：子代理运行的正文高亮主题对 + 行号开关。 */
  code?: CodeAppearance;
  /** 左缘拖拽把手 pointerdown（宽度调整由 App 实现）。 */
  onResizeStart?: (event: React.PointerEvent) => void;
}

/** 标签图标（chip / 标签列表 / 类型菜单共用）。 */
function dockTabIcon(tab: DockTabInstance): typeof Bot {
  if (tab.kind === "subagents") return Bot;
  if (tab.kind === "review") return FileSearch;
  if (tab.kind === "file") return FileText;
  if (tab.kind === "terminal") return SquareTerminal;
  if (tab.kind === "browser") return Globe;
  return MessagesSquare;
}

/** 首页功能格。占位列禁用并给出原因（aria-description + title）。 */
function HomeTile({
  icon: Icon,
  label,
  available,
  unavailableReason,
  onOpen,
}: {
  icon: typeof Bot;
  label: string;
  available: boolean;
  unavailableReason: string;
  onOpen?: () => void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      disabled={!available}
      onClick={onOpen}
      {...(available ? {} : { "aria-description": unavailableReason, title: unavailableReason })}
      className={`flex flex-col items-center gap-2 rounded-(--radius-pop) border border-(--color-border) bg-(--color-raised) px-3 py-4 ${
        available
          ? "transition-colors hover:border-(--color-border-hover) hover:bg-(--color-hover)"
          : "cursor-not-allowed opacity-45"
      }`}
    >
      <Icon size={18} strokeWidth={1.4} className="text-(--color-muted)" aria-hidden />
      <span className="text-[13px] text-(--color-foreground)">{label}</span>
    </button>
  );
}

/** 「打开标签页」首页（对齐参考形态：标题 + 副文案 + 功能格网格）。 */
function DockHome({ t, onNewTab }: { t: (key: string) => string; onNewTab: (kind: DockTabKind) => void }): React.JSX.Element {
  const unavailable = t("dock.tile.unavailable");
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-6 px-6">
      <div className="text-center">
        <div className="text-[15px] font-semibold text-(--color-foreground-strong)">{t("dock.home.title")}</div>
        <div className="mt-1 text-[13px] text-(--color-faint)">{t("dock.home.subtitle")}</div>
      </div>
      <div className="grid w-full grid-cols-2 gap-2.5">
        <HomeTile icon={MessagesSquare} label={t("dock.tile.chat")} available unavailableReason={unavailable} onOpen={() => onNewTab("aux")} />
        <HomeTile icon={Bot} label={t("dock.subagents")} available unavailableReason={unavailable} onOpen={() => onNewTab("subagents")} />
        <HomeTile icon={FileSearch} label={t("dock.tile.review")} available unavailableReason={unavailable} onOpen={() => onNewTab("review")} />
        <HomeTile icon={SquareTerminal} label={t("dock.tile.terminal")} available unavailableReason={unavailable} onOpen={() => onNewTab("terminal")} />
        <HomeTile icon={Globe} label={t("dock.tile.browser")} available unavailableReason={unavailable} onOpen={() => onNewTab("browser")} />
      </div>
    </div>
  );
}

/** 标签图标（chip / 标签列表共用）；浏览器标签有 favicon 时优先展示。 */
function DockTabIcon({ tab }: { tab: DockTabInstance }): React.JSX.Element {
  if (tab.kind === "browser" && tab.favicon) {
    return <img src={tab.favicon} alt="" className="size-3.5 shrink-0 rounded-sm" />;
  }
  const Icon = dockTabIcon(tab);
  return <Icon size={14} strokeWidth={1.5} className="shrink-0 text-(--color-muted)" aria-hidden />;
}

/** 标签类型菜单行（＋ 下拉）：可用即开新标签，占位禁用带原因。 */
function NewTabMenuRow({
  icon: Icon,
  label,
  available,
  unavailableReason,
  onPick,
}: {
  icon: typeof Bot;
  label: string;
  available: boolean;
  unavailableReason: string;
  onPick?: () => void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      disabled={!available}
      onClick={onPick}
      {...(available ? {} : { "aria-description": unavailableReason, title: unavailableReason })}
      className={`flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-[13px] ${
        available ? "text-(--color-foreground) hover:bg-(--color-hover)" : "cursor-not-allowed opacity-45"
      }`}
    >
      <Icon size={15} strokeWidth={1.5} className="shrink-0 text-(--color-muted)" aria-hidden />
      {label}
    </button>
  );
}

/** 标签条：ˇ 打开标签列表 + chip 横排 + ＋ 类型菜单。 */
function TabStrip({
  t,
  tabs,
  activeTabId,
  activeCount,
  onActivateTab,
  onCloseTab,
  onNewTab,
}: {
  t: (key: string) => string;
  tabs: DockTabInstance[];
  activeTabId: string | null;
  activeCount: number;
  onActivateTab: (id: string) => void;
  onCloseTab: (id: string) => void;
  onNewTab: (kind: DockTabKind) => void;
}): React.JSX.Element {
  const [listOpen, setListOpen] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const listed = q === "" ? tabs : tabs.filter((tab) => dockTabTitle(t, tab, tabs).toLowerCase().includes(q));
  const unavailable = t("dock.tile.unavailable");
  return (
    <div className="flex h-11 shrink-0 items-center gap-1 border-b border-(--color-hairline) px-2">
      {/* ˇ：打开的标签页列表（搜索 + 相对时间 + 逐个关闭）。 */}
      <RadixPopover.Root open={listOpen} onOpenChange={setListOpen}>
        <RadixPopover.Trigger asChild>
          <button
            type="button"
            aria-label={t("dock.tabs.open")}
            title={t("dock.tabs.open")}
            aria-expanded={listOpen}
            className="grid size-7 shrink-0 place-items-center rounded-md text-(--color-muted) hover:bg-(--color-hover) hover:text-(--color-foreground)"
          >
            <ChevronDown size={15} strokeWidth={1.5} />
          </button>
        </RadixPopover.Trigger>
        <RadixPopover.Portal>
          <RadixPopover.Content
            align="start"
            side="bottom"
            sideOffset={6}
            className="dropdown-in z-50 w-[260px] rounded-(--radius-pop) border border-(--color-border) bg-(--color-popup) p-1.5 shadow-(--shadow-pop)"
          >
            <div className="mb-1 flex items-center gap-2 rounded-md bg-(--color-surface) px-2.5 py-1.5">
              <Search size={13} className="shrink-0 text-(--color-faint)" aria-hidden />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t("dock.tabs.search")}
                aria-label={t("dock.tabs.search")}
                className="w-full bg-transparent text-[13px] outline-none placeholder:text-(--color-faint)"
              />
            </div>
            <div className="px-2 pt-1 pb-0.5 text-[12px] text-(--color-faint) select-none">{t("dock.tabs.open")}</div>
            <ul className="scrollbar-thin max-h-64 overflow-y-auto">
              {listed.map((tab) => (
                <li key={tab.id}>
                  <div
                    onClick={() => {
                      onActivateTab(tab.id);
                      setListOpen(false);
                    }}
                    className={`flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-[13px] ${
                      tab.id === activeTabId ? "bg-(--color-selected) text-(--color-foreground)" : "text-(--color-foreground) hover:bg-(--color-hover)"
                    }`}
                  >
                    <DockTabIcon tab={tab} />
                    <span className="min-w-0 flex-1 truncate">{dockTabTitle(t, tab, tabs)}</span>
                    <span className="shrink-0 text-[12px] text-(--color-faint)">{relativeTabTime(t, tab.createdAt)}</span>
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        onCloseTab(tab.id);
                        if (tabs.length <= 1) setListOpen(false);
                      }}
                      aria-label={t("dock.closeTab")}
                      title={t("dock.closeTab")}
                      className="grid size-5 shrink-0 place-items-center rounded text-(--color-faint) hover:bg-(--color-hover) hover:text-(--color-foreground)"
                    >
                      <X size={12} strokeWidth={1.5} />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </RadixPopover.Content>
        </RadixPopover.Portal>
      </RadixPopover.Root>
      {/* 标签 chip 横排。 */}
      <div className="scrollbar-thin flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            className={`flex h-7 shrink-0 items-center gap-1.5 rounded-lg pr-1 pl-2.5 ${
              tab.id === activeTabId ? "bg-(--color-selected) text-(--color-foreground-strong)" : "text-(--color-muted) hover:bg-(--color-hover)"
            }`}
          >
            <button
              type="button"
              onClick={() => onActivateTab(tab.id)}
              className="flex min-w-0 items-center gap-1.5"
            >
              <DockTabIcon tab={tab} />
              <span className="max-w-32 truncate text-[13px]">{dockTabTitle(t, tab, tabs)}</span>
              {tab.kind === "subagents" && activeCount > 0 && (
                <span className="grid min-w-4 shrink-0 place-items-center rounded-full bg-(--color-accent) px-1 font-mono text-[10px] leading-4 text-(--color-background)">
                  {activeCount}
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={() => onCloseTab(tab.id)}
              aria-label={t("dock.closeTab")}
              title={t("dock.closeTab")}
              className="grid size-5 shrink-0 place-items-center rounded text-(--color-faint) hover:bg-(--color-hover) hover:text-(--color-foreground)"
            >
              <X size={12} strokeWidth={1.5} />
            </button>
          </div>
        ))}
      </div>
      {/* ＋：标签类型菜单（辅助对话/子代理可用，其余占位禁用）。 */}
      <RadixPopover.Root open={newOpen} onOpenChange={setNewOpen}>
        <RadixPopover.Trigger asChild>
          <button
            type="button"
            aria-label={t("dock.home.title")}
            title={t("dock.home.title")}
            aria-expanded={newOpen}
            className="grid size-7 shrink-0 place-items-center rounded-md text-(--color-muted) hover:bg-(--color-hover) hover:text-(--color-foreground)"
          >
            <Plus size={15} strokeWidth={1.5} />
          </button>
        </RadixPopover.Trigger>
        <RadixPopover.Portal>
          <RadixPopover.Content
            align="end"
            side="bottom"
            sideOffset={6}
            className="dropdown-in z-50 w-[200px] rounded-(--radius-pop) border border-(--color-border) bg-(--color-popup) p-1.5 shadow-(--shadow-pop)"
          >
            <NewTabMenuRow icon={MessagesSquare} label={t("dock.tile.chat")} available unavailableReason={unavailable} onPick={() => { onNewTab("aux"); setNewOpen(false); }} />
            <NewTabMenuRow icon={Bot} label={t("dock.subagents")} available unavailableReason={unavailable} onPick={() => { onNewTab("subagents"); setNewOpen(false); }} />
            <NewTabMenuRow icon={FileSearch} label={t("dock.tile.review")} available unavailableReason={unavailable} onPick={() => { onNewTab("review"); setNewOpen(false); }} />
            <NewTabMenuRow icon={SquareTerminal} label={t("dock.tile.terminal")} available unavailableReason={unavailable} onPick={() => { onNewTab("terminal"); setNewOpen(false); }} />
            <NewTabMenuRow icon={Globe} label={t("dock.tile.browser")} available unavailableReason={unavailable} onPick={() => { onNewTab("browser"); setNewOpen(false); }} />
          </RadixPopover.Content>
        </RadixPopover.Portal>
      </RadixPopover.Root>
    </div>
  );
}

/** 「文件」标签：完整路径头 + 修改内容（红绿行块，编辑/写入行）或原文（读取行结果）。 */
function DockFileView({ t, tab }: { t: (key: string) => string; tab: DockTabInstance }): React.JSX.Element {
  const file = tab.file;
  return (
    <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
      <div className="space-y-2 p-3">
        {file?.path && (
          <div className="truncate font-mono text-[12px] text-(--color-faint) select-all" title={file.path}>
            {file.path}
          </div>
        )}
        {file?.diff ? (
          <DiffBlock removed={file.diff.removed} added={file.diff.added} />
        ) : file?.originalText ? (
          <pre className="scrollbar-thin w-full min-w-0 overflow-auto rounded-xl bg-(--color-background) p-2.5 font-mono code-text whitespace-pre text-(--color-foreground)">
            {file.originalText}
          </pre>
        ) : (
          <div className="text-(--color-faint)">{t("tool.status.empty")}</div>
        )}
      </div>
    </div>
  );
}

export function RightDock({
  t,
  tabs,
  activeTabId,
  onActivateTab,
  onCloseTab,
  onNewTab,
  runs,
  selectedChildId,
  onSelect,
  renderAuxTab,
  renderReviewTab,
  renderTerminalTab,
  renderBrowserTab,
  onResizeStart,
  code,
}: Props): React.JSX.Element {
  const activeCount = runs.filter(isRunning).length;
  const selected = runs.find((run) => run.childId === selectedChildId) ?? null;
  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? null;
  return (
    <aside
      data-testid="right-dock"
      className="relative flex h-full w-full flex-col border-l border-(--color-hairline) bg-(--color-background)"
    >
      {/* 左缘拖拽把手：5px 热区叠在分界线上，悬停显 accent 色。 */}
      {onResizeStart && (
        <div
          data-testid="right-dock-resize-handle"
          role="separator"
          aria-orientation="vertical"
          onPointerDown={onResizeStart}
          className="group absolute inset-y-0 left-0 z-10 w-[5px] cursor-col-resize touch-none"
        >
          <div className="mx-auto h-full w-px transition-colors group-hover:bg-(--color-accent)" />
        </div>
      )}
      {activeTab !== null && (
        <TabStrip
          t={t}
          tabs={tabs}
          activeTabId={activeTabId}
          activeCount={activeCount}
          onActivateTab={onActivateTab}
          onCloseTab={onCloseTab}
          onNewTab={onNewTab}
        />
      )}
      {activeTab === null && <DockHome t={t} onNewTab={onNewTab} />}
      {activeTab?.kind === "review" && renderReviewTab()}
      {activeTab?.kind === "file" && <DockFileView t={t} tab={activeTab} />}
      {activeTab?.kind === "subagents" &&
        (selected ? (
          <RunConversation t={t} run={selected} onBack={() => onSelect?.(null)} code={code} />
        ) : (
          <SubagentsList t={t} runs={runs} onOpen={(childId) => onSelect?.(childId)} />
        ))}
      {/* aux/terminal 标签常驻挂载用 display:none；browser 标签用
          absolute+invisible——display:none 会卸载 <webview> 访客插件。 */}
      {tabs
        .filter((tab) => tab.kind === "aux" || tab.kind === "terminal" || tab.kind === "browser")
        .map((tab) => {
          const active = tab.id === activeTabId;
          const className = active
            ? "flex min-h-0 flex-1 flex-col"
            : tab.kind === "browser"
              ? "pointer-events-none absolute inset-0 invisible"
              : "hidden";
          return (
            <div key={tab.id} className={className}>
              {tab.kind === "aux" ? renderAuxTab(tab) : tab.kind === "terminal" ? renderTerminalTab(tab) : renderBrowserTab(tab)}
            </div>
          );
        })}
    </aside>
  );
}
