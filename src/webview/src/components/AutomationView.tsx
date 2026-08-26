import { ArrowLeft, Clock3, Plus, Sparkles, Workflow } from "lucide-react";
import { useState } from "react";

interface AutomationCandidate {
  trigger: string;
  action: string;
  constraints: string;
}

function candidateFor(prompt: string): AutomationCandidate {
  const normalized = prompt.trim();
  return {
    trigger: "定时或闲时触发（待确认）",
    action: normalized,
    constraints: "执行前需要用户审查并确认所有工具动作",
  };
}

export function AutomationView({ onBack }: { onBack: () => void }): React.JSX.Element {
  const [creating, setCreating] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [candidate, setCandidate] = useState<AutomationCandidate | null>(null);

  return (
    <main className="flex h-full min-w-0 flex-1 flex-col">
      <header className="flex h-11 shrink-0 items-center gap-2 border-b border-(--color-app-hairline) px-4">
        <button type="button" onClick={onBack} aria-label="返回聊天" className="grid size-7 place-items-center rounded-full text-(--color-app-muted) hover:bg-(--color-app-bubble)"><ArrowLeft size={14} /></button>
        <h1 className="text-[13px] font-semibold">自动化</h1>
      </header>
      <div className="grid flex-1 place-items-center overflow-auto p-6">
        {!creating ? (
          <div className="max-w-sm text-center">
            <span className="mx-auto mb-4 grid size-12 place-items-center rounded-2xl border border-(--color-app-border) bg-(--color-app-bubble) text-(--color-app-accent)"><Workflow size={22} /></span>
            <h2 className="text-base font-semibold">创建自动化任务</h2>
            <p className="mt-2 text-[12px] leading-relaxed text-(--color-app-muted)">使用自然语言描述定时或闲时任务；生成的触发条件和操作会在执行前供你审查。</p>
            <button type="button" onClick={() => setCreating(true)} className="mx-auto mt-4 inline-flex items-center gap-1.5 rounded-full bg-(--color-app-accent) px-3 py-1.5 text-[12px] text-(--color-app-accent-fg)"><Plus size={13} />新建自动化</button>
            <div className="mt-3 flex items-center justify-center gap-1 text-[10px] text-(--color-app-muted)"><Clock3 size={11} />支持定时与闲时触发</div>
          </div>
        ) : (
          <section className="w-full max-w-lg rounded-2xl border border-(--color-app-border) bg-(--color-app-panel) p-5 shadow-(--shadow-card)">
            <h2 className="flex items-center gap-2 text-sm font-semibold"><Sparkles size={15} className="text-(--color-app-accent)" />生成自动化候选</h2>
            <label className="mt-4 flex flex-col gap-1.5 text-[12px] text-(--color-app-muted)">
              自动化需求
              <textarea aria-label="自动化需求" value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="例如：每天整理未完成任务" rows={4} className="resize-y rounded-lg border border-(--color-app-border) bg-(--color-app-bg) p-2.5 text-sm text-(--color-app-text) outline-none focus:border-(--color-app-accent)" />
            </label>
            <div className="mt-3 flex justify-end gap-2">
              <button type="button" onClick={() => { setCreating(false); setCandidate(null); }} className="rounded-lg border border-(--color-app-border) px-3 py-1.5 text-[12px]">取消</button>
              <button type="button" disabled={prompt.trim() === ""} onClick={() => setCandidate(candidateFor(prompt))} className="rounded-lg bg-(--color-app-accent) px-3 py-1.5 text-[12px] text-(--color-app-accent-fg) disabled:opacity-40">生成候选</button>
            </div>
            {candidate && (
              <div className="mt-4 rounded-xl border border-(--color-app-hairline) bg-(--color-app-bg) p-3 text-[12px]">
                <h3 className="font-semibold">候选方案</h3>
                <dl className="mt-2 grid gap-2 text-(--color-app-muted)">
                  <div><dt className="font-medium text-(--color-app-text)">触发条件</dt><dd>{candidate.trigger}</dd></div>
                  <div><dt className="font-medium text-(--color-app-text)">操作</dt><dd>{candidate.action}</dd></div>
                  <div><dt className="font-medium text-(--color-app-text)">约束</dt><dd>{candidate.constraints}</dd></div>
                </dl>
                <button type="button" aria-label="提交自动化" aria-description="当前 host 尚未提供自动化提交接口" disabled className="mt-3 rounded-lg bg-(--color-app-accent) px-3 py-1.5 text-[12px] text-(--color-app-accent-fg) opacity-45">提交自动化</button>
                <p className="mt-2 text-[10px] text-(--color-app-muted)">当前 host 尚未提供自动化提交接口；候选仅供审查，不会执行或持久化。</p>
              </div>
            )}
          </section>
        )}
      </div>
    </main>
  );
}
