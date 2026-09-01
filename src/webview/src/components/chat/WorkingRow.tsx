import { LoaderCircle } from "lucide-react";
import type { MessagePart } from "../../../../shared/ipc";

export type WorkingState =
  | { kind: "idle" }
  | { kind: "start" }
  | { kind: "thinking" }
  | { kind: "tool"; toolName: string };

/** 从消息 parts 推断当前活动状态（真空档检测）：存在未完成的 toolCall
 *  → 工具执行中；末尾是 thinking → 思考中；末段是 text → 正在出字
 *  （stream-caret 已覆盖，无需此行）；其余（空 parts / 工具间过渡）→ 进行中。 */
export function workingStateOf(parts: MessagePart[]): WorkingState {
  if (parts.length === 0) return { kind: "start" };
  const pending = new Set<string>();
  for (const p of parts) {
    if (p.type === "toolCall") pending.add(p.id);
    else if (p.type === "toolResult") pending.delete(p.toolCallId);
  }
  if (pending.size > 0) {
    let lastPending = "";
    for (const p of parts) if (p.type === "toolCall") lastPending = p.toolName;
    return { kind: "tool", toolName: lastPending };
  }
  const last = parts[parts.length - 1]!;
  if (last.type === "thinking") return { kind: "thinking" };
  if (last.type === "text") return { kind: "idle" };
  return { kind: "start" }; // 末尾是 toolResult：两个工具之间 / 即将收尾
}

/** 消息尾部的活动指示行（参考稿 tail-spin）：旋转环 + 当前动作标签，
 * 只在无文字流出的真空档渲染（文本流出时由 stream-caret 接管）。 */
export function WorkingRow({ state, t }: { state: WorkingState; t: (key: string) => string }): React.JSX.Element | null {
  if (state.kind === "idle") return null;
  if (state.kind === "thinking") {
    return (
      <div className="flex items-center gap-2.5 py-1 text-(--color-app-muted)">
        <span className="orbs" aria-hidden>
          <i />
          <i />
          <i />
        </span>
        {t("chat.working.thinking")}
      </div>
    );
  }
  if (state.kind === "tool") {
    return (
      <div className="tool-sweep flex items-center gap-2.5 rounded-md px-0.5 py-1 text-(--color-app-muted)">
        <LoaderCircle size={15} className="animate-spin" />
        {t("chat.working.tool").replace("{tool}", state.toolName)}
      </div>
    );
  }
  return (
    <div className="tool-sweep flex items-center gap-2.5 rounded-md px-0.5 py-1 text-(--color-app-muted)">
      <LoaderCircle size={15} className="animate-spin" />
      {t("chat.working.start")}
    </div>
  );
}
