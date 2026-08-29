import { Bot, Check, ChevronDown } from "lucide-react";
import { Popover } from "../ui/Popover";

export interface AgentModeOption { id: string; title: string; description?: string; }

/** 内建模式 id（staging 清单的 agent-mode 条目）：label 与 desc 均走 i18n。 */
const BUILTIN_MODE_IDS = new Set(["default", "creation", "plan", "focus", "minimal", "learning", "auto"]);

/** 内置模式用 i18n 显示；用户自建模式显示元数据 title。 */
export function labelFor(t: (k: string) => string, id: string, options: AgentModeOption[]): string {
  if (BUILTIN_MODE_IDS.has(id)) return t(`agentMode.${id}`);
  return options.find((o) => o.id === id)?.title ?? id;
}

/** 模式描述（选项悬浮提示）：内置模式（同一内建集合）走 i18n 描述键；用户模式回落元数据 description，无则空串（不渲染 title）。 */
export function descFor(t: (k: string) => string, id: string, options: AgentModeOption[]): string {
  if (BUILTIN_MODE_IDS.has(id)) return t(`agentMode.${id}.desc`);
  return options.find((o) => o.id === id)?.description ?? "";
}

export function AgentModePicker({
  t, value, options, onChange,
}: {
  t: (key: string) => string;
  value: string;
  options: AgentModeOption[];
  onChange: (v: string) => void;
}): React.JSX.Element {
  const triggerDesc = descFor(t, value, options);
  return (
    <Popover
      contentClassName="w-36 p-1"
      trigger={
        <button type="button" aria-label={t("agentMode.select")}
          title={triggerDesc || undefined}
          className="flex items-center gap-1 rounded-full px-2 py-1 text-[11px] hover:bg-(--color-app-bubble)">
          <Bot size={13} className="shrink-0 text-(--color-app-accent)" />
          <span>{labelFor(t, value, options)}</span>
          <ChevronDown size={11} className="shrink-0" />
        </button>
      }
    >
      {options.map((o) => {
        const desc = descFor(t, o.id, options);
        return (
          <button key={o.id} type="button" onClick={() => onChange(o.id)}
            title={desc || undefined}
            className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[11.5px] hover:bg-(--color-app-bubble)/60 ${o.id === value ? "text-(--color-app-accent)" : "text-(--color-app-muted)"}`}>
            <span>{labelFor(t, o.id, options)}</span>
            {o.id === value && <Check size={12} className="ml-auto shrink-0" />}
          </button>
        );
      })}
    </Popover>
  );
}
