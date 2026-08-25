import { useState } from "react";
import { Activity, KeyRound } from "lucide-react";

/** 密钥输入：不回显主进程保存的值；仅显示配置状态，编辑文本仅用于单向提交。 */
export function ApiKeyField({
  configured, website, onChange, onCheck,
}: {
  configured?: boolean;
  website?: string;
  onChange: (key: string) => void;
  onCheck: () => void;
}): React.JSX.Element {
  const [draft, setDraft] = useState("");
  const [dirty, setDirty] = useState(false);
  return (
    <div className="flex h-8 items-center gap-1 rounded-lg border border-(--color-app-hairline) bg-(--color-app-bg) px-2">
      <KeyRound size={12} className="shrink-0 text-(--color-app-muted)" />
      <input
        type="password"
        value={draft}
        onChange={(e) => {
          setDirty(true);
          setDraft(e.target.value);
        }}
        onBlur={() => {
          if (!dirty) return;
          onChange(draft);
          setDraft("");
          setDirty(false);
        }}
        placeholder={configured ? "已配置（输入新密钥以替换）" : "API 密钥"}
        className="w-full bg-transparent font-mono text-[12px] outline-none placeholder:font-sans placeholder:text-(--color-app-muted)"
      />
      <button type="button" aria-label="检查连接" onClick={onCheck} className="shrink-0 text-(--color-app-muted) hover:text-(--color-app-text)">
        <Activity size={13} />
      </button>
      {website && (
        <a href={website} target="_blank" rel="noreferrer" className="shrink-0 text-[11px] text-(--color-app-accent)">获取密钥</a>
      )}
    </div>
  );
}
