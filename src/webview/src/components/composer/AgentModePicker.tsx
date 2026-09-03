// Agent 模式选择器：与权限选择器同构（弹层列表 + 勾选当前项），标题下带描述行。
// 内置模式 id 走 i18n（agentMode.<id>[.desc]）；用户安装的模式无对应键时回落
// 目录原文（title/description）。弹层限高滚动，模式多时不顶出窗口。
import { Bot, Check, ChevronDown } from "lucide-react";
import type { AgentModeInfo } from "../../../../shared/ipc";
import { dictHas } from "../../lib/i18n";
import { Popover } from "../ui/Popover";

function modeTitle(t: (key: string) => string, mode: AgentModeInfo | undefined): string {
  if (!mode) return t("agentMode.default");
  const key = `agentMode.${mode.id}`;
  return dictHas(key) ? t(key) : mode.title;
}

function modeDescription(t: (key: string) => string, mode: AgentModeInfo): string | undefined {
  const key = `agentMode.${mode.id}.desc`;
  return dictHas(key) ? t(key) : mode.description;
}

export function AgentModePicker({
  t,
  modes,
  value,
  onChange,
}: {
  t: (key: string) => string;
  modes: AgentModeInfo[];
  value: string;
  onChange: (id: string) => void;
}): React.JSX.Element {
  // 选中项不在目录（模式插件已移除）时按 main 的回落语义展示 default。
  const active = modes.find((mode) => mode.id === value) ?? modes[0];
  return (
    <Popover
      contentClassName="scrollbar-thin max-h-80 w-64 overflow-y-auto p-1"
      trigger={
        <button
          type="button"
          aria-label={t("agentMode")}
          title={t("agentMode")}
          className="flex items-center gap-1.5 rounded-md px-1.5 py-1 text-(--color-foreground) outline-none hover:bg-(--color-hover)"
        >
          <Bot size={14} />
          <span>{modeTitle(t, active)}</span>
          <ChevronDown size={11} className="text-(--color-faint)" />
        </button>
      }
    >
      {modes.map((mode) => {
        const description = modeDescription(t, mode);
        return (
          <button
            key={mode.id}
            type="button"
            onClick={() => onChange(mode.id)}
            className={`flex w-full items-start gap-2 rounded-lg px-2.5 py-1.5 text-left hover:bg-(--color-hover) ${
              mode.id === value ? "text-(--color-foreground)" : "text-(--color-muted)"
            }`}
          >
            <span className="min-w-0 flex-1">
              <span className="block">{modeTitle(t, mode)}</span>
              {description && <span className="block text-(--color-faint)">{description}</span>}
            </span>
            {mode.id === value && <Check size={13} className="mt-1 shrink-0 text-(--color-accent)" />}
          </button>
        );
      })}
    </Popover>
  );
}
