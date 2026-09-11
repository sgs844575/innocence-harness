import { useState } from "react";
import { ChevronLeft, ChevronRight, WandSparkles } from "lucide-react";

const PAGE_SIZE = 10;
export function AvailableSkills({ skills, query, label }: {
  skills: { name: string; description: string }[];
  query: string;
  label: (key: string) => string;
}): React.JSX.Element {
  const [page, setPage] = useState(0);
  const filtered = skills.filter((s) => `${s.name} ${s.description}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const current = Math.min(page, pages - 1);
  const button = "rounded-lg border border-(--color-border) p-1.5 hover:bg-(--color-hover) focus-visible:outline-2 focus-visible:outline-(--color-accent) disabled:opacity-45";
  return <section className="mt-7" aria-label={label("provided")}>
    <h2 className="mb-4">{label("provided")} <span className="text-(--color-muted)">{filtered.length}</span></h2>
    <ul className="divide-y divide-(--color-hairline) overflow-hidden rounded-(--radius-pop) bg-(--color-panel)">{filtered.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE).map((skill) => <li key={skill.name} className="flex items-center gap-3 px-4 py-3">
      <WandSparkles size={18} strokeWidth={1.4} className="shrink-0 text-(--color-muted)" />
      <div className="min-w-0"><p className="truncate">{skill.name}</p><p title={skill.description} className="truncate text-[12px] text-(--color-muted)">{skill.description}</p></div>
    </li>)}</ul>
    {!filtered.length && <p role="status" className="py-8 text-center text-(--color-muted)">{label("empty")}</p>}
    {pages > 1 && <nav aria-label={label("pagination")} className="mt-3 flex items-center justify-end gap-3 text-(--color-muted)">
      <button className={button} aria-label={label("previous")} disabled={current === 0} onClick={() => setPage(current - 1)}><ChevronLeft size={16} /></button>
      <span aria-live="polite">{current + 1} / {pages}</span>
      <button className={button} aria-label={label("next")} disabled={current === pages - 1} onClick={() => setPage(current + 1)}><ChevronRight size={16} /></button>
    </nav>}
  </section>;
}
