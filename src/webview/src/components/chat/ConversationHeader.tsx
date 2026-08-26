import { GitBranch, MoreHorizontal, FolderGit2 } from "lucide-react";

export interface ConversationHeaderProps {
  task: string;
  project: string;
  branch: string | null;
  runtimeLabel?: string;
}

export function ConversationHeader({ task, project, branch, runtimeLabel }: ConversationHeaderProps): React.JSX.Element {
  return (
    <header className="chat-header flex min-h-11 shrink-0 items-center gap-2 border-b border-(--color-app-hairline) px-[clamp(16px,3vw,32px)]">
      <h1 className="min-w-0 flex-1 truncate text-[13px] font-semibold text-(--color-app-text)">{task}</h1>
      {project && (
        <span className="chat-context-chip hidden max-w-[190px] items-center gap-1.5 truncate rounded-full px-2.5 py-1 text-[11px] text-(--color-app-muted) sm:flex">
          <FolderGit2 size={12} className="shrink-0" />
          <span className="truncate">{project}</span>
        </span>
      )}
      {branch && (
        <span className="chat-context-chip hidden max-w-[150px] items-center gap-1.5 truncate rounded-full px-2.5 py-1 font-mono text-[10.5px] text-(--color-app-muted) md:flex">
          <GitBranch size={11} className="shrink-0" />
          <span className="truncate">{branch}</span>
        </span>
      )}
      {runtimeLabel && <span className="hidden text-[10px] text-(--color-app-muted) lg:inline">{runtimeLabel}</span>}
      <button type="button" aria-label="更多聊天操作" className="grid size-7 shrink-0 place-items-center rounded-full text-(--color-app-muted) hover:bg-(--color-app-bubble) hover:text-(--color-app-text)">
        <MoreHorizontal size={15} />
      </button>
    </header>
  );
}
