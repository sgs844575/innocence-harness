// 工具行模型（纯函数，可单测）：toolCall/toolResult 配对成紧凑行——
// 动词（编辑/写入/读取/终端…）+ 标题（文件名/命令）+ 路径 + ±diff 计数。
import type { MessagePart, ToolCallPart, ToolResultPart } from "../../../../shared/ipc";

export interface ToolRowModel {
  id: string;
  toolName: string;
  verbKey: string;
  /** 行标题：文件名 / 命令摘要 / 模式。 */
  title: string;
  /** 标题后的弱化补充：目录路径等。 */
  detail?: string;
  /** 文件行的归一化完整路径（/ 分隔），用于在 dock 打开文件标签。 */
  filePath?: string;
  /** 该次调用的关联键（子代理行据此定位面板卡片）。 */
  invocationId?: string;
  additions?: number;
  deletions?: number;
  running: boolean;
  isError: boolean;
  resultText?: string;
  /** 编辑/写入展开的 diff 明细（删除行/新增行原文）。 */
  diff?: { removed: string; added: string };
  /** 终端展开的命令摘要。 */
  command?: string;
  /** todo 清单（todo 工具的展开内容）。 */
  todos?: TodoItem[];
}

/** 工具名 → 动词 i18n key（时间线工具行与子代理面板轨迹共用）。 */
export function verbKeyFor(toolName: string): string {
  const name = toolName.toLowerCase();
  // 顺序敏感：todowrite 同时含 write/read 子串，todo/task 必须先判。
  if (name.includes("todo")) return "tool.verb.todo";
  if (name.includes("task") || name.includes("agent")) return "tool.verb.task";
  if (name.includes("edit")) return "tool.verb.edit";
  if (name.includes("write")) return "tool.verb.write";
  if (name.includes("read")) return "tool.verb.read";
  if (name.includes("bash") || name.includes("shell") || name.includes("terminal")) return "tool.verb.bash";
  if (name.includes("glob")) return "tool.verb.glob";
  if (name.includes("grep") || name.includes("search")) return "tool.verb.grep";
  return "tool.verb.default";
}

function countLines(text: string): number {
  if (text === "") return 0;
  return text.split("\n").length;
}

function fileTitle(args: Record<string, unknown>): { title: string; detail?: string; path?: string } {
  const raw = typeof args.file_path === "string" ? args.file_path : typeof args.path === "string" ? args.path : "";
  if (!raw) return { title: "" };
  const normalized = raw.replace(/\\/g, "/");
  const segments = normalized.split("/").filter(Boolean);
  const title = segments.pop() ?? raw;
  return { title, detail: segments.join("/"), path: normalized };
}

function summarize(call: ToolCallPart): Omit<ToolRowModel, "running" | "isError"> {
  const verbKey = verbKeyFor(call.toolName);
  const args = call.args;
  let title = "";
  let detail: string | undefined;
  let filePath: string | undefined;
  let additions: number | undefined;
  let deletions: number | undefined;
  let diff: ToolRowModel["diff"];
  let command: string | undefined;
  let todos: TodoItem[] | undefined;

  if (verbKey === "tool.verb.edit" || verbKey === "tool.verb.write" || verbKey === "tool.verb.read") {
    ({ title, detail, path: filePath } = fileTitle(args));
    if (verbKey !== "tool.verb.read") {
      const nextText = typeof args.content === "string" ? args.content : typeof args.new_string === "string" ? args.new_string : "";
      const prevText = typeof args.old_string === "string" ? args.old_string : "";
      additions = countLines(nextText);
      deletions = countLines(prevText);
      if (verbKey === "tool.verb.write") deletions = 0;
      if (nextText || prevText) diff = { removed: prevText, added: nextText };
    }
  } else if (verbKey === "tool.verb.bash") {
    title = typeof args.command === "string" ? args.command : "";
    command = title || undefined;
  } else if (verbKey === "tool.verb.glob" || verbKey === "tool.verb.grep") {
    title = typeof args.pattern === "string" ? args.pattern : "";
  } else if (verbKey === "tool.verb.todo") {
    const rawTodos = Array.isArray(args.todos) ? args.todos : [];
    todos = rawTodos
      .filter((todo) => typeof (todo as { content?: unknown }).content === "string")
      .map((todo) => ({
        content: (todo as { content: string }).content,
        status: normalizeTodoStatus((todo as { status?: unknown }).status),
      }));
    const done = todos.filter((todo) => todo.status === "completed").length;
    const current = todos.find((todo) => todo.status === "in_progress");
    title = current?.content ?? "";
    detail = todos.length > 0 ? `${done}/${todos.length}` : undefined;
  } else if (verbKey === "tool.verb.task") {
    title = typeof args.description === "string" ? args.description : typeof args.prompt === "string" ? String(args.prompt).slice(0, 60) : "";
  }

  return {
    id: call.id,
    toolName: call.toolName,
    verbKey,
    title,
    detail,
    filePath,
    invocationId: call.invocationId,
    additions,
    deletions,
    diff,
    command,
    todos,
  };
}

function normalizeTodoStatus(status: unknown): TodoItem["status"] {
  return status === "completed" || status === "in_progress" ? status : "pending";
}

/** 按序配对 toolCall 与其 toolResult（同 id）；无结果 = 运行中。 */
export function buildToolRows(parts: readonly MessagePart[]): ToolRowModel[] {
  const calls = parts.filter((p): p is ToolCallPart => p.type === "toolCall");
  const results = new Map(parts.filter((p): p is ToolResultPart => p.type === "toolResult").map((p) => [p.toolCallId, p]));
  return calls.map((call) => {
    const result = results.get(call.id);
    return {
      ...summarize(call),
      running: result === undefined,
      isError: result?.isError === true,
      resultText: result?.content,
    };
  });
}

export interface TodoItem {
  content: string;
  status: "pending" | "in_progress" | "completed";
}

/** 面板轨迹行的最小形状（state/subagentRuns 的 SubagentRunToolRow 同构，
 *  结构化入参避免本模块反向依赖 state 层）。 */
export interface RunToolRowInput {
  name: string;
  done: boolean;
  isError?: boolean;
  title?: string;
  /** call 阶段参数的**有界投影**（harness-agent clipToolArgs 截断）；有值时
   *  复用主时间线 summarize() 产出富工具行（diff/±计数/命令/todo 展开）。 */
  args?: Record<string, unknown>;
  result?: string;
  at: number;
}

/** 子代理运行的轨迹 → 时间线工具行模型（与主聊天同一 ToolRow 渲染）：
 *  有 args 时构造临时 ToolCallPart 走 summarize() 得到动词/文件路径/±diff
 *  计数/展开明细（title 为空回退轨迹摘要），无 args 的旧档案保持简版行：
 *  摘要作标题、未配对 = 运行中、result 摘录作展开内容。 */
export function runToolsToTimelineRows(tools: readonly RunToolRowInput[]): ToolRowModel[] {
  return tools.map((tool, index) => {
    if (tool.args) {
      const summary = summarize({ type: "toolCall", id: `run-tool-${index}`, toolName: tool.name, args: tool.args });
      return {
        ...summary,
        title: summary.title || tool.title || "",
        running: !tool.done,
        isError: tool.isError === true,
        ...(tool.result !== undefined ? { resultText: tool.result } : {}),
      };
    }
    return {
      id: `run-tool-${index}`,
      toolName: tool.name,
      verbKey: verbKeyFor(tool.name),
      title: tool.title ?? "",
      running: !tool.done,
      isError: tool.isError === true,
      ...(tool.result !== undefined ? { resultText: tool.result } : {}),
    };
  });
}

/** 进程段数据源：消息里最近一次 todo 工具调用的清单。 */
export function latestTodos(messages: readonly { parts: MessagePart[] }[]): TodoItem[] {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const parts = messages[i]!.parts;
    for (let j = parts.length - 1; j >= 0; j -= 1) {
      const part = parts[j]!;
      if (part.type === "toolCall" && part.toolName.toLowerCase().includes("todo") && Array.isArray(part.args.todos)) {
        return (part.args.todos as { content?: unknown; status?: unknown }[])
          .filter((todo) => typeof todo.content === "string")
          .map((todo) => ({
            content: todo.content as string,
            status:
              todo.status === "completed" || todo.status === "in_progress" ? todo.status : "pending",
          }));
      }
    }
  }
  return [];
}
