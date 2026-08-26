import { ArrowLeft, Clock3, Plus, Workflow } from "lucide-react";

export function AutomationView({ onBack }: { onBack: () => void }): React.JSX.Element {
  return (
    <main className="flex h-full min-w-0 flex-1 flex-col">
      <header className="flex h-11 shrink-0 items-center gap-2 border-b border-(--color-app-hairline) px-4">
        <button type="button" onClick={onBack} aria-label="返回聊天" className="grid size-7 place-items-center rounded-full text-(--color-app-muted) hover:bg-(--color-app-bubble)"><ArrowLeft size={14} /></button>
        <h1 className="text-[13px] font-semibold">自动化</h1>
      </header>
      <div className="grid flex-1 place-items-center p-6">
        <div className="max-w-sm text-center">
          <span className="mx-auto mb-4 grid size-12 place-items-center rounded-2xl border border-(--color-app-border) bg-(--color-app-bubble) text-(--color-app-accent)"><Workflow size={22} /></span>
          <h2 className="text-base font-semibold">创建自动化任务</h2>
          <p className="mt-2 text-[12px] leading-relaxed text-(--color-app-muted)">使用自然语言描述定时或闲时任务；生成的触发条件和操作会在执行前供你审查。</p>
          <button type="button" className="mx-auto mt-4 inline-flex items-center gap-1.5 rounded-full bg-(--color-app-accent) px-3 py-1.5 text-[12px] text-(--color-app-accent-fg)"><Plus size={13} />新建自动化</button>
          <div className="mt-3 flex items-center justify-center gap-1 text-[10px] text-(--color-app-muted)"><Clock3 size={11} />支持定时与闲时触发</div>
        </div>
      </div>
    </main>
  );
}
