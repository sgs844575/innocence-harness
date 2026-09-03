// 工具行（对齐参考规格）：图标(16px) + 动词(运行中渐变文字) + 文件图标与名称
// + 路径 + ±diff(mono tabular-nums)。编辑/写入/读取行拆两个点击目标：文件簇
// （图标+名称+路径+±计数）在右侧 dock 打开文件标签（修改内容或原文），末尾
// chevron 下拉按钮走现存的内联展开预览；Task（子代理）行不做下拉展开——整行
// 点击携带关联键/标题/结果文本在 dock 解析到该次运行的会话（runForTaskRow：
// 键优先，无键旧记录按标题唯一匹配，无法唯一确定时落子代理归档列表）；其余
// 行整行点击展开。
// 展开区：diff 红绿行块（max-h-60 限高自滚动，防长写入撑爆时间线）/ 终端卡 /
// todo 清单 / 结果块；运行中无内容时给脉冲占位，完成但无输出时给「无输出」。
import { useState } from "react";
import {
  Bot,
  Check,
  ChevronRight,
  Circle,
  FileText,
  ListTodo,
  LoaderCircle,
  PanelRight,
  Pencil,
  Search,
  SquareTerminal,
} from "lucide-react";
import type { TaskRowClue } from "../../state/subagentRuns";
import type { ToolRowModel } from "./toolRows";

/** Task 行的面板定位载荷：关联键（新记录）+ 标题/结果文本（旧记录回退匹配）。 */
function taskRowClue(row: ToolRowModel): TaskRowClue {
  return {
    ...(row.invocationId !== undefined ? { invocationId: row.invocationId } : {}),
    ...(row.title ? { title: row.title } : {}),
    ...(row.resultText ? { resultText: row.resultText } : {}),
  };
}

function rowIcon(row: ToolRowModel): typeof FileText {
  switch (row.verbKey) {
    case "tool.verb.edit":
    case "tool.verb.write":
      return Pencil;
    case "tool.verb.read":
    case "tool.verb.glob":
    case "tool.verb.grep":
      return Search;
    case "tool.verb.bash":
      return SquareTerminal;
    case "tool.verb.todo":
      return ListTodo;
    case "tool.verb.task":
      return Bot;
    default:
      return FileText;
  }
}

/** diff 行块：14% 着色底 + 内嵌 3px 色条，等宽 +/− 前缀；不换行，横向滚动。
 *  导出给 dock 文件标签复用（同为组件导出，不影响 Fast Refresh）。
 *  高度由调用方经 className 控制：时间线展开区传 max-h-60 限高自滚动，
 *  dock 文件标签不传（面板自身布局）。 */
export function DiffBlock({
  removed,
  added,
  className = "",
}: {
  removed: string;
  added: string;
  className?: string;
}): React.JSX.Element {
  const removedLines = removed === "" ? [] : removed.split("\n");
  const addedLines = added === "" ? [] : added.split("\n");
  return (
    <div className={`scrollbar-thin w-full min-w-0 max-w-full overflow-auto rounded-xl bg-(--color-background) font-mono code-text leading-relaxed ${className}`}>
      {removedLines.map((line, index) => (
        <div key={`d${index}`} className="diff-line-del w-fit min-w-full px-2.5 whitespace-pre">
          <span className="mr-2 inline-block w-3 text-(--color-diff-del) select-none">−</span>
          <span className="text-(--color-foreground)">{line}</span>
        </div>
      ))}
      {addedLines.map((line, index) => (
        <div key={`a${index}`} className="diff-line-add w-fit min-w-full px-2.5 whitespace-pre">
          <span className="mr-2 inline-block w-3 text-(--color-diff-add) select-none">+</span>
          <span className="text-(--color-foreground)">{line}</span>
        </div>
      ))}
    </div>
  );
}

/** 终端卡：$ 命令摘要 + 输出。 */
function CommandBlock({ command, output }: { command?: string; output?: string }): React.JSX.Element {
  return (
    <div className="mb-2 space-y-3 rounded-xl border border-(--color-border) bg-(--color-panel) px-4 py-3">
      {command && (
        <div className="flex items-start gap-2">
          <span className="shrink-0 text-(--color-muted) select-none">$</span>
          <pre className="max-h-15 truncate font-sans text-(--color-foreground)" title={command}>{command}</pre>
        </div>
      )}
      {output && (
        <pre className="scrollbar-thin max-h-25 overflow-auto whitespace-pre font-mono code-text text-(--color-muted)">
          {output.length > 4000 ? `${output.slice(0, 4000)}…` : output}
        </pre>
      )}
    </div>
  );
}

/** todo 清单展开：状态图标 + 文案（完成划线、进行中最深）。 */
function TodoList({ todos }: { todos: NonNullable<ToolRowModel["todos"]> }): React.JSX.Element {
  return (
    <ul className="space-y-1 rounded-xl bg-(--color-surface) px-3 py-2">
      {todos.map((todo, index) => (
        <li key={index} className="flex min-w-0 items-center gap-2 py-1">
          {todo.status === "completed" ? (
            <Check size={14} className="size-3.5 shrink-0 text-(--color-tool-ok)" />
          ) : todo.status === "in_progress" ? (
            <LoaderCircle size={14} className="size-3.5 shrink-0 animate-spin text-(--color-accent)" />
          ) : (
            <Circle size={14} className="size-3.5 shrink-0 text-(--color-faint)" />
          )}
          <span
            className={`min-w-0 truncate ${
              todo.status === "completed"
                ? "text-(--color-faint) line-through"
                : todo.status === "in_progress"
                  ? "text-(--color-foreground)"
                  : "text-(--color-muted)"
            }`}
          >
            {todo.content}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function ToolRow({
  t,
  row,
  onOpenSubagent,
  onOpenFile,
}: {
  t: (key: string) => string;
  row: ToolRowModel;
  /** 子代理行：整行点击在右侧 dock 打开该次运行的会话；载荷携带关联键 +
   *  行标题/结果文本，供无键旧记录在面板侧按标题唯一匹配（见 runForTaskRow）。 */
  onOpenSubagent?: (clue: TaskRowClue) => void;
  /** 文件行（编辑/写入/读取）：文件簇点击在右侧 dock 打开文件标签。 */
  onOpenFile?: (row: ToolRowModel) => void;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const Icon = rowIcon(row);
  const isTaskRow = row.verbKey === "tool.verb.task";
  // Task 行（子代理）不做下拉展开：整行跳转 dock（有关联键直达该次运行，无键落列表）。
  const subagentLink = isTaskRow && onOpenSubagent !== undefined;
  const fileLink = !subagentLink && row.filePath && onOpenFile ? row.filePath : undefined;
  const expandable = !subagentLink && !isTaskRow;
  const toggle = (): void => setOpen((value) => !value);
  const countsRow =
    (row.additions !== undefined && row.additions > 0) || (row.deletions !== undefined && row.deletions > 0) ? (
      <span className="inline-flex shrink-0 items-center gap-1 font-mono leading-none whitespace-nowrap tabular-nums">
        {/* 参考规格：只显示非零侧（纯删除编辑只出 −N）。 */}
        {row.additions !== undefined && row.additions > 0 && (
          <span className="text-(--color-diff-add)">+{row.additions}</span>
        )}
        {row.deletions !== undefined && row.deletions > 0 && (
          <span className="text-(--color-diff-del)">−{row.deletions}</span>
        )}
      </span>
    ) : null;
  const titleCluster = row.title ? (
    <>
      <span className="inline-flex min-w-0 max-w-full items-center gap-1.5 text-(--color-muted)">
        {(row.verbKey === "tool.verb.edit" || row.verbKey === "tool.verb.write" || row.verbKey === "tool.verb.read") && (
          <FileText size={16} className="size-4 shrink-0 text-(--color-muted)" aria-hidden />
        )}
        <span className="min-w-0 truncate font-mono">{row.title}</span>
      </span>
      {row.detail && <span className="min-w-0 truncate text-(--color-faint)">{row.detail}</span>}
    </>
  ) : null;
  return (
    <div className="group/tool-row w-full">
      <div className="group/tool-summary inline-flex max-w-full items-center gap-2 self-start text-left">
        <button
          type="button"
          onClick={subagentLink ? () => onOpenSubagent?.(taskRowClue(row)) : expandable ? toggle : undefined}
          {...(expandable ? { "aria-expanded": open } : {})}
          title={subagentLink ? t("tool.task.openPanel") : fileLink ? undefined : row.detail ? `${row.detail}/${row.title}` : row.title || t(row.verbKey)}
          className={`inline-flex min-w-0 items-center gap-2 transition-colors ${
            subagentLink || expandable ? "cursor-pointer" : "cursor-default"
          }`}
        >
          <Icon size={16} className="size-4 shrink-0 text-(--color-muted)" aria-hidden />
          <span
            className={`shrink-0 font-medium whitespace-nowrap ${
              row.running ? "animated-gradient-text" : "text-(--color-faint)"
            }`}
          >
            {t(row.verbKey)}
          </span>
          {!fileLink && titleCluster}
          {!fileLink && countsRow}
          {row.isError && (
            <span
              title={row.resultText?.slice(0, 200)}
              className="shrink-0 cursor-help whitespace-nowrap underline decoration-dotted underline-offset-2 text-(--color-tool-err)"
            >
              {t("tool.status.failed")}
            </span>
          )}
          {subagentLink && (
            <PanelRight
              size={16}
              aria-hidden
              className="size-4 shrink-0 text-(--color-faint) opacity-0 transition-opacity group-hover/tool-summary:opacity-100 motion-reduce:transition-none"
            />
          )}
        </button>
        {fileLink && (
          <button
            type="button"
            onClick={() => onOpenFile?.(row)}
            aria-label={t("tool.openFile")}
            title={fileLink}
            className="inline-flex min-w-0 max-w-full cursor-pointer items-center gap-2 rounded-md text-(--color-muted) transition-colors hover:text-(--color-foreground)"
          >
            {titleCluster}
            {countsRow}
          </button>
        )}
        {expandable && (
          <button
            type="button"
            onClick={toggle}
            aria-expanded={open}
            aria-label={t("tool.preview")}
            title={t("tool.preview")}
            className={`grid size-5 shrink-0 cursor-pointer place-items-center rounded text-(--color-faint) transition-[opacity] duration-(--duration-fast) ease-(--ease-smooth-out) hover:bg-(--color-hover) hover:text-(--color-foreground) motion-reduce:transition-none ${
              open ? "opacity-100" : "opacity-0 group-hover/tool-summary:opacity-100 focus-visible:opacity-100"
            }`}
          >
            <ChevronRight
              size={16}
              aria-hidden
              className={`size-4 transition-[transform] duration-(--duration-fast) ease-(--ease-smooth-out) motion-reduce:transition-none ${
                open ? "rotate-90" : ""
              }`}
            />
          </button>
        )}
      </div>
      {expandable && (
        <div className="acc-panel" data-open={open}>
          <div className="acc-panel-inner">
            <div className="space-y-2 pt-2">
              {row.diff && <DiffBlock removed={row.diff.removed} added={row.diff.added} className="max-h-60" />}
              {!row.diff && row.command !== undefined && <CommandBlock command={row.command} output={row.resultText} />}
              {!row.diff && row.command === undefined && row.todos && <TodoList todos={row.todos} />}
              {!row.diff && row.command === undefined && !row.todos && row.resultText && (
                <pre
                  className={`scrollbar-thin max-h-60 overflow-auto rounded-md p-2 font-mono code-text whitespace-pre ${
                    row.isError ? "bg-(--color-tool-err)/10 text-(--color-tool-err)" : "bg-(--color-surface) text-(--color-foreground)"
                  }`}
                >
                  {row.resultText.length > 4000 ? `${row.resultText.slice(0, 4000)}…` : row.resultText}
                </pre>
              )}
              {!row.diff && row.command === undefined && !row.todos && !row.resultText &&
                (row.running ? (
                  <div className="h-6 animate-pulse rounded-md bg-(--color-surface)" />
                ) : (
                  <div className="text-(--color-faint)">{t("tool.status.empty")}</div>
                ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** 一段连续工具调用的时间线列（行距 16px）。 */
export function ToolTimeline({
  t,
  rows,
  onOpenSubagent,
  onOpenFile,
}: {
  t: (key: string) => string;
  rows: ToolRowModel[];
  onOpenSubagent?: (clue: TaskRowClue) => void;
  onOpenFile?: (row: ToolRowModel) => void;
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-4">
      {rows.map((row) => (
        <ToolRow key={row.id} t={t} row={row} onOpenSubagent={onOpenSubagent} onOpenFile={onOpenFile} />
      ))}
    </div>
  );
}
