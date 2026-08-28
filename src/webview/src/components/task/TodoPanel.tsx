import { Circle, CircleCheck, CircleDot } from "lucide-react";
import type { TodoView } from "../context-capsule/activityProjection";

export interface TodoPanelProps {
  todos?: readonly TodoView[];
  completed: number;
  total: number;
  pending: number;
  onOpen?: () => void;
}

export function TodoPanel({ todos, completed, total, pending, onOpen }: TodoPanelProps): React.JSX.Element {
  return (
    <div className="space-y-2 px-3 pb-3 text-[10.5px] text-(--color-app-muted)">
      <div className="flex items-center justify-between">
        <span>已完成</span>
        <span>{completed}/{total}</span>
      </div>
      {todos?.map((todo, index) => (
        <div key={`${todo.status}-${todo.content}-${index}`} className="flex items-start gap-2 rounded-md bg-(--color-app-bubble) px-2 py-1.5 text-(--color-app-text)">
          {todo.status === "completed" ? <CircleCheck size={11} className="mt-0.5 shrink-0 text-(--color-tool-ok)" /> : todo.status === "in_progress" ? <CircleDot size={11} className="mt-0.5 shrink-0 text-(--color-app-accent)" /> : <Circle size={11} className="mt-0.5 shrink-0 text-(--color-app-muted)" />}
          <span className={todo.status === "completed" ? "line-through opacity-70" : ""}>{todo.content}</span>
        </div>
      ))}
      <div className="flex items-center justify-between">
        <span>待处理 {pending} 项</span>
        <button type="button" disabled={!onOpen} onClick={onOpen} className="capsule-action">打开进程</button>
      </div>
    </div>
  );
}
