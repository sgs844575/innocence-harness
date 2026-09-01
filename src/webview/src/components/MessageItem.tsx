import { GitBranch, GitFork, Pencil, RotateCcw } from "lucide-react";
import type { ChatMessage } from "../../../shared/ipc";
import { messageText } from "../../../shared/ipc";
import type { ValidationResult } from "../../../shared/taskIpc";
import { MessageFrame } from "./chat/MessageFrame";
import { CompletionMetadata } from "./chat/CompletionMetadata";
import { TaskChangeCard } from "./task/TaskChangeCard";
import type { TaskChangeSummary } from "./task/taskViewModel";

export interface ForkMessageCommand {
  turnId: string;
  mode: "edit-user" | "retry-assistant";
  text: string;
}

/** 该轮的任务变更摘要（IPC view model 片段，Task 12 接完整 task context）。 */
export interface TaskChangeCardCommand {
  summary: TaskChangeSummary;
  checkpointId: string;
  validation: ValidationResult | null;
}

export function MessageItem({
  t, message, onForkMessage, onForkSession, taskChange, onOpenTaskReview, providerNameOf,
}: {
  t: (key: string) => string;
  message: ChatMessage;
  onForkMessage?: (command: ForkMessageCommand) => void;
  /** M1 会话 fork：非任务会话的用户消息动作（任务会话走路线分叉）。
   *  mode="worktree" 为工作树分叉（A:95：父 Git 工作区建分离工作树）。 */
  onForkSession?: (messageId: string, mode?: "text" | "worktree") => void;
  taskChange?: TaskChangeCardCommand;
  onOpenTaskReview?: () => void;
  /** completion.providerId → 供应商显示名（ChatView 按 settings.profiles 解析）。 */
  providerNameOf?: (providerId?: string) => string | undefined;
}): React.JSX.Element {
  const text = messageText(message.parts);
  if (message.role === "user") {
    return (
      <div className="rise-in group flex flex-col items-end">
        <div className="max-w-[85%] rounded-[12px] rounded-br-[3px] bg-(--color-app-bubble) px-4 py-2.5 leading-relaxed whitespace-pre-wrap">
          {text}
        </div>
        {(onForkMessage || onForkSession) && (
          <div className="mt-1 flex gap-1 opacity-0 hover:opacity-100 group-hover:opacity-100 focus-within:opacity-100">
            {onForkMessage && (
              <button
                type="button"
                title="编辑并创建路线"
                aria-label="编辑并创建路线"
                onClick={() => onForkMessage({ turnId: message.id, mode: "edit-user", text })}
                className="flex h-7 items-center gap-1 px-2 text-(--color-app-muted) hover:bg-(--color-app-bubble)"
              >
                <Pencil size={13} /> 编辑并创建路线
              </button>
            )}
            {onForkSession && (
              <button
                type="button"
                title="从这里分叉会话"
                aria-label="从这里分叉会话"
                onClick={() => onForkSession(message.id)}
                className="flex h-7 items-center gap-1 px-2 text-(--color-app-muted) hover:bg-(--color-app-bubble)"
              >
                <GitFork size={13} /> 从这里分叉
              </button>
            )}
            {onForkSession && (
              <button
                type="button"
                title="从这里分叉到工作树"
                aria-label="从这里分叉到工作树"
                onClick={() => onForkSession(message.id, "worktree")}
                className="flex h-7 items-center gap-1 px-2 text-(--color-app-muted) hover:bg-(--color-app-bubble)"
              >
                <GitBranch size={13} /> 分叉到工作树
              </button>
            )}
          </div>
        )}
      </div>
    );
  }
  return (
    <div className="rise-in group">
      <MessageFrame parts={message.parts} streaming={message.streaming === true} t={t} />
      <CompletionMetadata completion={message.completion} providerName={providerNameOf?.(message.completion?.providerId)} />
      {taskChange && (
        <div className="mt-2">
          <TaskChangeCard
            summary={taskChange.summary}
            checkpointId={taskChange.checkpointId}
            validation={taskChange.validation}
            t={t}
            onReview={onOpenTaskReview}
          />
        </div>
      )}
      {onForkMessage && !message.streaming && (
        <div className="mt-1 flex gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100">
          <button
            type="button"
            title="重试并创建路线"
            onClick={() => onForkMessage({ turnId: message.id, mode: "retry-assistant", text })}
            className="flex h-7 items-center gap-1 px-2 text-(--color-app-muted) hover:bg-(--color-app-bubble)"
          >
            <RotateCcw size={13} /> 重试并创建路线
          </button>
        </div>
      )}
    </div>
  );
}
