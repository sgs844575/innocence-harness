import type { SubagentStatus } from "../../../../shared/ipc";

export interface SubagentPanelChild {
  childId: string;
  parentSessionId: string;
  description: string;
  status: SubagentStatus;
  text: string;
  error?: string;
}

export function SubagentPanel({ child }: { child: SubagentPanelChild | null }): React.JSX.Element {
  if (!child) {
    return <div className="grid flex-1 place-items-center px-4 py-8 text-(--color-app-muted)">选择一个子智能体查看输出</div>;
  }
  const statusLabel = child.status === "completed"
    ? "已完成"
    : child.status === "failed"
      ? "失败"
      : child.status === "cancelled"
        ? "已取消"
        : child.status;
  return (
    <section className="flex min-h-0 flex-1 flex-col gap-3 p-4" aria-label={child.description || "子智能体"}>
      <header className="flex items-center gap-2 border-b border-(--color-app-hairline) pb-3">
        <h2 className="min-w-0 flex-1 truncate font-medium">{child.description || "子智能体"}</h2>
        <span className="shrink-0 text-(--color-app-muted)">{statusLabel}</span>
      </header>
      {child.text && <div className="whitespace-pre-wrap leading-relaxed text-(--color-app-text)">{child.text}</div>}
      {child.error ? (
        <div role="alert" className="whitespace-pre-wrap text-(--color-tool-err)">{child.error}</div>
      ) : !child.text ? (
        <div className="grid flex-1 place-items-center text-(--color-app-muted)">
          {child.status === "started" || child.status === "running" ? "正在加载子会话…" : "子会话没有输出"}
        </div>
      ) : null}
    </section>
  );
}
