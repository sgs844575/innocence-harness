import { ArrowLeft, Clock3, Play, Plus, Sparkles, Workflow } from "lucide-react";
import { useEffect, useState } from "react";
import type { AutomationCandidate, AutomationDefinition } from "../../../shared/automationIpc";
import { api } from "../lib/ipc";

interface AutomationViewProps {
  onBack: () => void;
  sessionId?: string;
  taskId?: string;
  routeId?: string;
}

export function AutomationView({ onBack, sessionId = "", taskId, routeId = "main" }: AutomationViewProps): React.JSX.Element {
  const [creating, setCreating] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [name, setName] = useState("");
  const [candidate, setCandidate] = useState<AutomationCandidate | null>(null);
  const [definitions, setDefinitions] = useState<AutomationDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void api.listAutomations().then(
      (items) => { if (active) setDefinitions(items); },
      () => { if (active) setError("无法加载自动化定义"); },
    ).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const generate = async (): Promise<void> => {
    const normalized = prompt.trim();
    if (!normalized) return;
    setSubmitting(true);
    setError(null);
    try {
      setCandidate(await api.generateAutomationCandidate(normalized));
    } catch {
      setError("无法生成有效的自动化候选");
    } finally {
      setSubmitting(false);
    }
  };

  const confirm = async (): Promise<void> => {
    if (!candidate || !name.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const definition = await api.confirmAutomation({ candidate, name: name.trim(), ...(sessionId ? { targetSessionId: sessionId } : {}) });
      setDefinitions((items) => [...items.filter((item) => item.id !== definition.id), definition]);
      setCreating(false);
      setCandidate(null);
      setPrompt("");
      setName("");
    } catch {
      setError("无法保存自动化定义");
    } finally {
      setSubmitting(false);
    }
  };

  const trigger = async (definition: AutomationDefinition): Promise<void> => {
    setSubmitting(true);
    setError(null);
    try {
      await api.triggerAutomation({
        id: definition.id,
        trigger: "manual",
        sessionId,
        ...(taskId ? { taskId } : {}),
        routeId,
      });
    } catch {
      setError("无法启动自动化任务");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      <header className="flex h-11 shrink-0 items-center gap-2 border-b border-(--color-app-hairline) px-4">
        <button type="button" onClick={onBack} aria-label="返回聊天" className="grid size-7 place-items-center rounded-full text-(--color-app-muted) hover:bg-(--color-app-bubble)"><ArrowLeft size={14} /></button>
        <h1 className="text-[13px] font-semibold">自动化</h1>
      </header>
      <div className="flex flex-1 flex-col overflow-auto p-6">
        {error && <p role="alert" className="mx-auto mb-3 max-w-lg text-xs text-(--color-tool-err)">{error}</p>}
        {!creating && (
          <div className="mx-auto w-full max-w-lg">
            <div className="text-center">
              <span className="mx-auto mb-4 grid size-12 place-items-center rounded-2xl border border-(--color-app-border) bg-(--color-app-bubble) text-(--color-app-accent)"><Workflow size={22} /></span>
              <h2 className="text-base font-semibold">创建自动化任务</h2>
              <p className="mt-2 text-[12px] leading-relaxed text-(--color-app-muted)">使用自然语言描述定时或闲时任务；候选配置经审查并确认后才会保存和执行。</p>
              <button type="button" onClick={() => setCreating(true)} className="mx-auto mt-4 inline-flex items-center gap-1.5 rounded-full bg-(--color-app-accent) px-3 py-1.5 text-[12px] text-(--color-app-accent-fg)"><Plus size={13} />新建自动化</button>
              <div className="mt-3 flex items-center justify-center gap-1 text-[10px] text-(--color-app-muted)"><Clock3 size={11} />支持定时与闲时触发</div>
            </div>
            <section aria-label="已保存自动化" className="mt-8 grid gap-2">
              {loading ? <p className="text-center text-xs text-(--color-app-muted)">正在加载自动化…</p> : definitions.length === 0 ? <p className="text-center text-xs text-(--color-app-muted)">尚无已确认的自动化</p> : definitions.map((definition) => (
                <article key={definition.id} className="rounded-xl border border-(--color-app-hairline) bg-(--color-app-bg) p-3 text-[12px]">
                  <div className="flex items-center gap-2"><h3 className="font-semibold">{definition.name}</h3><span className="text-(--color-app-muted)">{definition.candidate.trigger.kind === "idle" ? "闲时" : "定时"}</span></div>
                  <p className="mt-1 text-(--color-app-muted)">{definition.candidate.reviewSummary}</p>
                  <button type="button" disabled={submitting || !definition.enabled || !sessionId} onClick={() => void trigger(definition)} aria-label={`立即执行 ${definition.name}`} className="mt-2 inline-flex items-center gap-1 rounded-lg border border-(--color-app-border) px-2 py-1 text-[11px] disabled:opacity-40"><Play size={11} />立即执行</button>
                </article>
              ))}
            </section>
          </div>
        )}
        {creating && (
          <section className="mx-auto w-full max-w-lg rounded-2xl border border-(--color-app-border) bg-(--color-app-panel) p-5 shadow-(--shadow-card)">
            <h2 className="flex items-center gap-2 text-sm font-semibold"><Sparkles size={15} className="text-(--color-app-accent)" />生成自动化候选</h2>
            <label className="mt-4 flex flex-col gap-1.5 text-[12px] text-(--color-app-muted)">自动化需求<textarea aria-label="自动化需求" value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="例如：每天整理未完成任务" rows={4} className="resize-y rounded-lg border border-(--color-app-border) bg-(--color-app-bg) p-2.5 text-sm text-(--color-app-text) outline-none focus:border-(--color-app-accent)" /></label>
            <div className="mt-3 flex justify-end gap-2"><button type="button" disabled={submitting} onClick={() => { setCreating(false); setCandidate(null); }} className="rounded-lg border border-(--color-app-border) px-3 py-1.5 text-[12px]">取消</button><button type="button" disabled={submitting || prompt.trim() === ""} onClick={() => void generate()} className="rounded-lg bg-(--color-app-accent) px-3 py-1.5 text-[12px] text-(--color-app-accent-fg) disabled:opacity-40">{submitting ? "生成中…" : "生成候选"}</button></div>
            {candidate && <div className="mt-4 rounded-xl border border-(--color-app-hairline) bg-(--color-app-bg) p-3 text-[12px]"><h3 className="font-semibold">候选方案</h3><dl className="mt-2 grid gap-2 text-(--color-app-muted)"><div><dt className="font-medium text-(--color-app-text)">触发条件</dt><dd>{candidate.trigger.kind}: {candidate.trigger.expression}</dd></div><div><dt className="font-medium text-(--color-app-text)">操作</dt><dd>{candidate.actions.map((action) => action.command).join("；")}</dd></div><div><dt className="font-medium text-(--color-app-text)">约束</dt><dd>{candidate.constraints.join("；")}</dd></div></dl><label className="mt-3 flex flex-col gap-1 text-(--color-app-muted)">名称<input aria-label="自动化名称" value={name} onChange={(event) => setName(event.target.value)} className="rounded-lg border border-(--color-app-border) bg-(--color-app-panel) px-2 py-1 text-(--color-app-text)" /></label><button type="button" disabled={submitting || !name.trim()} onClick={() => void confirm()} className="mt-3 rounded-lg bg-(--color-app-accent) px-3 py-1.5 text-[12px] text-(--color-app-accent-fg) disabled:opacity-40">提交自动化</button></div>}
          </section>
        )}
      </div>
    </div>
  );
}
