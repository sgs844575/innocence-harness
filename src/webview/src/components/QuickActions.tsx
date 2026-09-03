import { Bug, Clock, FileText, Presentation } from "lucide-react";

interface QuickAction {
  id: string;
  labelKey: string;
  promptKey: string;
  icon: typeof FileText;
}

const ACTIONS: readonly QuickAction[] = [
  { id: "weekly", labelKey: "chat.quick.weekly", promptKey: "chat.quick.weekly.prompt", icon: FileText },
  { id: "bugfix", labelKey: "chat.quick.bugfix", promptKey: "chat.quick.bugfix.prompt", icon: Bug },
  { id: "slides", labelKey: "chat.quick.slides", promptKey: "chat.quick.slides.prompt", icon: Presentation },
  { id: "idle", labelKey: "chat.quick.idle", promptKey: "chat.quick.idle.prompt", icon: Clock },
];

/** 落地页快捷动作 chips：点击把模板 prompt 填入输入卡（不直接发送）。 */
export function QuickActions({
  t,
  onPick,
}: {
  t: (key: string) => string;
  onPick: (prompt: string) => void;
}): React.JSX.Element {
  return (
    <div
      className="stagger-in mt-4 flex flex-wrap items-center justify-center gap-2.5"
      style={{ "--i": 2 } as React.CSSProperties}
    >
      {ACTIONS.map(({ id, labelKey, promptKey, icon: Icon }) => (
        <button
          key={id}
          type="button"
          onClick={() => onPick(t(promptKey))}
          title={t(labelKey)}
          className="flex h-8 items-center gap-1.5 rounded-full border border-(--color-border) bg-(--color-raised) px-3 text-(--color-muted) transition-colors hover:bg-(--color-hover) hover:text-(--color-foreground)"
        >
          <Icon size={13} strokeWidth={1.5} />
          {t(labelKey)}
        </button>
      ))}
    </div>
  );
}
