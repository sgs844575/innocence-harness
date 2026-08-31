import { ArrowRight, CircleCheck } from "lucide-react";
import type { TodoView } from "../context-capsule/activityProjection";

export interface TodoPanelProps {
  todos?: readonly TodoView[];
  completed: number;
  total: number;
  pending: number;
  onOpen?: () => void;
}

/** 进程清单（参考稿 wave 列表语言）：当前步 → 实心箭头，待办 → 空心圆环，
 * 完成 → 对勾划线；无底色行 + 13px/19px 行高，行距 14px。 */
export function TodoPanel({ todos, completed, total, pending, onOpen }: TodoPanelProps): React.JSX.Element {
  return (
    <div className="px-[18px] pb-[16px] text-[13px] text-(--color-app-muted)">
      <div className="flex h-[26px] items-center gap-[38px] pt-[8px]">
        <span>进程</span>
        <b className="font-normal text-(--color-app-text)">{completed}/{total}</b>
      </div>
      <div className="mt-[8px] flex flex-col gap-[14px]">
        {todos?.map((todo, index) => (
          <div key={`${todo.status}-${todo.content}-${index}`} className="flex items-start gap-[11px] leading-[19px] text-(--color-app-text)">
            <span className="mt-[3px] flex w-[13px] shrink-0 justify-center">
              {todo.status === "completed" ? (
                <CircleCheck size={12} className="text-(--color-tool-ok)" />
              ) : todo.status === "in_progress" ? (
                <ArrowRight size={12} className="text-(--color-app-accent)" />
              ) : (
                <span className="block size-[10px] rounded-full border-[1.3px] border-(--color-app-faint)" />
              )}
            </span>
            <span className={`min-w-0 flex-1 break-words ${todo.status === "completed" ? "line-through opacity-60" : ""}`}>{todo.content}</span>
          </div>
        ))}
      </div>
      <div className="mt-[14px] flex h-[26px] items-center justify-between">
        <span>待处理 {pending} 项</span>
        <button type="button" disabled={!onOpen} onClick={onOpen} className="capsule-action">打开进程</button>
      </div>
    </div>
  );
}
