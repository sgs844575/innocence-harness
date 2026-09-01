import { Globe, GitCompare, MessageSquare, SquareTerminal } from "lucide-react";
import type { ComponentType } from "react";
import type { WorkbenchTabId } from "./WorkbenchTabs";
import { zhCN } from "../../lib/i18n";

interface Props {
  onSelect: (tab: WorkbenchTabId) => void;
  t?: (key: string) => string;
}

const CARDS: readonly {
  tab: WorkbenchTabId;
  labelKey: string;
  icon: ComponentType<{ size?: number; className?: string }>;
}[] = [
  { tab: "assistant", labelKey: "workbench.home.assistant", icon: MessageSquare },
  { tab: "review", labelKey: "workbench.home.review", icon: GitCompare },
  { tab: "terminal", labelKey: "workbench.home.terminal", icon: SquareTerminal },
  { tab: "browser", labelKey: "workbench.home.browser", icon: Globe },
];

const tZh = (key: string): string => zhCN[key] ?? key;

const HOME_COPY: Record<string, string> = {
  "workbench.home.title": "工作台",
  "workbench.home.description": "选择一个工作区能力开始工作",
  "workbench.home.assistant": "辅助对话",
  "workbench.home.review": "审查",
  "workbench.home.terminal": "终端",
  "workbench.home.browser": "浏览器",
};

const copyFor = (t: (key: string) => string, key: string): string => {
  const translated = t(key);
  return translated === key ? HOME_COPY[key] ?? key : translated;
};

export function WorkbenchHome({ onSelect, t = tZh }: Props): React.JSX.Element {
  return (
    <section className="space-y-4 px-4 py-5" aria-labelledby="workbench-home-title">
      <div>
        <h1 id="workbench-home-title" className="font-semibold">{copyFor(t, "workbench.home.title")}</h1>
        <p className="mt-1 text-(--color-app-muted)">{copyFor(t, "workbench.home.description")}</p>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {CARDS.map(({ tab, labelKey, icon: Icon }) => (
          <button
            key={tab}
            type="button"
            aria-label={copyFor(t, labelKey)}
            onClick={() => onSelect(tab)}
            className="group flex items-center gap-3 rounded-xl border border-(--color-app-hairline) bg-(--color-app-panel) p-3 text-left transition-colors hover:border-(--color-app-accent) hover:bg-(--color-app-bubble)"
          >
            <Icon size={17} className="text-(--color-app-accent)" />
            <span className="font-medium text-(--color-app-text)">{copyFor(t, labelKey)}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
