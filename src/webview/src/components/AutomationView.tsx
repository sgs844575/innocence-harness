// 自动化页（简版）：列出已存自动化（名称/触发器/启停/删除）。
import { useEffect, useState } from "react";
import { ArrowLeft, Trash2, Workflow } from "lucide-react";
import type { AutomationCandidate, AutomationDefinition } from "../../../shared/automationIpc";
import { api, hasBridge } from "../lib/ipc";

export function AutomationView({
  t,
  onBack,
}: {
  t: (key: string) => string;
  onBack: () => void;
}): React.JSX.Element {
  const [items, setItems] = useState<AutomationDefinition[]>([]);

  useEffect(() => {
    if (!hasBridge()) return;
    void api.listAutomations().then(setItems).catch(() => undefined);
  }, []);

  const toggle = async (item: AutomationDefinition) => {
    await api
      .updateAutomation({
        id: item.id,
        // 持久化的宽松形态（trigger 省略 everyMs/idleForMs）回传时按原样透传。
        candidate: item.candidate as AutomationCandidate,
        name: item.name,
        targetSessionId: item.targetSessionId,
        enabled: !item.enabled,
      })
      .catch(() => undefined);
    setItems(await api.listAutomations().catch(() => items));
  };

  const remove = async (id: string) => {
    await api.deleteAutomation(id).catch(() => undefined);
    setItems((current) => current.filter((item) => item.id !== id));
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b border-(--color-hairline) px-5 py-3">
        <button
          type="button"
          onClick={onBack}
          aria-label={t("automation.back")}
          className="grid size-7 place-items-center rounded-md text-(--color-muted) hover:bg-(--color-hover) hover:text-(--color-foreground)"
        >
          <ArrowLeft size={15} />
        </button>
        <h1 className="font-bold text-(--color-foreground-strong)">{t("automation.title")}</h1>
      </div>
      <div className="scrollbar-thin flex-1 overflow-y-auto p-5">
        {items.length === 0 && (
          <div className="flex flex-col items-center gap-2 pt-16 text-(--color-muted)">
            <Workflow size={20} strokeWidth={1.3} />
            {t("automation.empty")}
          </div>
        )}
        <ul className="mx-auto max-w-[760px] space-y-2">
          {items.map((item) => (
            <li
              key={item.id}
              className="flex items-center gap-3 rounded-(--radius-pop) border border-(--color-border) bg-(--color-raised) px-4 py-3"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium text-(--color-foreground)">{item.name}</div>
                <div className="truncate text-(--color-faint)">{item.candidate.reviewSummary || item.candidate.trigger.expression}</div>
              </div>
              <button
                type="button"
                onClick={() => void toggle(item)}
                aria-pressed={item.enabled}
                className={`h-5 w-9 shrink-0 rounded-full transition-colors ${item.enabled ? "bg-(--color-accent)" : "bg-(--color-border)"}`}
              >
                <span
                  className={`block size-4 rounded-full bg-(--color-foreground-strong) transition-transform ${
                    item.enabled ? "translate-x-[18px]" : "translate-x-[2px]"
                  }`}
                />
              </button>
              <button
                type="button"
                aria-label={t("sidebar.delete")}
                onClick={() => void remove(item.id)}
                className="grid size-7 shrink-0 place-items-center rounded-md text-(--color-muted) hover:bg-(--color-hover) hover:text-(--color-tool-err)"
              >
                <Trash2 size={14} />
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
