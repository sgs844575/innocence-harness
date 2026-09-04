// 设置卡片行原语：SettingsRow（标题 + 描述 + 右侧控件，常规/外观/关于页共用）与
// TextSaveRow（草稿输入 + 保存按钮：未改动禁用，回车同效，提交时去首尾空白）。
import type { ReactNode } from "react";
import { useEffect, useState } from "react";

/** 卡片行：标题 + 描述（左）与控件（右），行间发丝分隔。 */
export function SettingsRow({ title, desc, children }: { title: string; desc?: string; children: ReactNode }): React.JSX.Element {
  return (
    <div className="flex items-center gap-4 px-4 py-3.5">
      <div className="min-w-0 flex-1">
        <div className="text-(--color-foreground-strong)">{title}</div>
        {desc && <div className="mt-0.5 text-(--color-muted)">{desc}</div>}
      </div>
      {children}
    </div>
  );
}

/** 文本保存行：草稿与已提交值不同才可保存；保存/回车提交去空白后的值。 */
export function TextSaveRow({
  title,
  desc,
  value,
  placeholder,
  saveLabel,
  onCommit,
}: {
  title: string;
  desc?: string;
  /** 已提交值（受控草稿的基准）。 */
  value: string;
  placeholder?: string;
  saveLabel: string;
  onCommit: (next: string) => void;
}): React.JSX.Element {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const dirty = draft !== value;
  const commit = (): void => {
    if (dirty) onCommit(draft.trim());
  };
  return (
    <SettingsRow title={title} desc={desc}>
      <div className="flex w-72 items-center gap-2">
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") commit();
          }}
          placeholder={placeholder}
          aria-label={title}
          className="h-8 min-w-0 flex-1 rounded-md border border-(--color-border) bg-(--color-surface) px-2.5 font-mono text-[13px] outline-none text-(--color-foreground) placeholder:text-(--color-faint) focus:border-(--color-accent)"
        />
        <button
          type="button"
          disabled={!dirty}
          onClick={commit}
          className="flex h-8 shrink-0 items-center rounded-md border border-(--color-border) bg-(--color-surface) px-2.5 text-(--color-muted) hover:bg-(--color-hover) hover:text-(--color-foreground) disabled:opacity-45"
        >
          {saveLabel}
        </button>
      </div>
    </SettingsRow>
  );
}
