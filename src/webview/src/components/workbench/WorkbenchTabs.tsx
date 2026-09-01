// WorkbenchTabs — workbench destinations (home/assistant/review/routes/code/todo/terminal/browser).
// Purely controlled: it displays the active state and emits tab-change commands;
// content rendering belongs to WorkbenchShell.
import { zhCN } from "../../lib/i18n";
import { useSlotList } from "../../slots/react";

const tZh = (key: string): string => zhCN[key] ?? key;

const TAB_LABELS: Partial<Record<WorkbenchTabId, string>> = {
  home: "首页",
  assistant: "辅助对话",
  review: "审查",
  routes: "路线",
  code: "代码",
  todo: "待办",
  terminal: "终端",
  browser: "浏览器",
};

function labelFor(t: (key: string) => string, id: WorkbenchTabId, labelKey: string): string {
  const translated = t(labelKey);
  return translated === labelKey ? TAB_LABELS[id] ?? id : translated;
}

export type WorkbenchTabId = "home" | "assistant" | "review" | "routes" | "code" | "todo" | "terminal" | "browser" | (string & {});

/** 面板槽位标识：每个页签一条贡献（render 闭包持有该页签的面板内容）。 */
export const PANEL_SLOT = "workbench.panel";

/** 面板槽位的一条贡献：id=页签、labelKey=页签文案、render=面板内容。 */
export interface WorkbenchPanelContribution {
  id: WorkbenchTabId;
  labelKey: string;
  render: () => React.ReactNode;
}

/** 从槽位派生页签清单（注册序保序）。 */
export function useWorkbenchTabs(): readonly { id: WorkbenchTabId; labelKey: string }[] {
  const contributions = useSlotList<WorkbenchPanelContribution>(PANEL_SLOT);
  return contributions.map(({ id, labelKey }) => ({ id, labelKey }));
}

export interface WorkbenchTabsProps {
  active: WorkbenchTabId;
  onSelect: (tab: WorkbenchTabId) => void;
  t?: (key: string) => string;
}

export function WorkbenchTabs({ active, onSelect, t = tZh }: WorkbenchTabsProps): React.JSX.Element {
  const tabs = useWorkbenchTabs();
  return (
    <div role="tablist" aria-label={t("workbench.panel.title")} className="flex min-w-0 flex-1 items-center gap-0.5">
      {tabs.map(({ id, labelKey }) => {
        const isActive = id === active;
        return (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onSelect(id)}
            className={`h-7 shrink-0 rounded-md px-2.5 transition-colors ${
              isActive
                ? "bg-(--color-app-sunken) font-medium text-(--color-app-text)"
                : "text-(--color-app-muted) hover:bg-(--color-app-hover) hover:text-(--color-app-text)"
            }`}
          >
            {labelFor(t, id, labelKey)}
          </button>
        );
      })}
    </div>
  );
}
