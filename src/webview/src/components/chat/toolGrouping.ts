// 工具行分组（纯函数，可单测）：一条助手消息的有序工具行 → 行/分组显示列表。
// 三类分组——explore（读取/搜索：Read/Glob/Grep）、changes（写入/补丁：Write/Edit）、
// terminal（非只读 Shell：Bash；只读命令不入组，见 isReadOnlyCommand）——各自由
// 独立设置门控；2+ 连续同类行才聚合成组，单行保持原行，非同类行打断连续段。
// Task（子代理）/TodoWrite 等特殊交互行无类别，永不入组。
import type { HarnessSettings } from "../../../../shared/ipc";
import type { ToolRowModel } from "./toolRows";

export type ToolGroupCategory = "explore" | "terminal" | "changes";

export interface ToolGroupingOptions {
  explore: boolean;
  terminal: boolean;
  changes: boolean;
}

/** 消息流显示开关（设置解析结果）：思考过滤 / todo 过滤 / 工具分组。 */
export interface StreamDisplayOptions {
  showThinking: boolean;
  showTodos: boolean;
  grouping: ToolGroupingOptions;
}

/** 设置 → 消息流显示开关。默认：思考/todo 开；explore/terminal 分组开、changes 分组关。 */
export function streamDisplayFromSettings(settings: HarnessSettings | null | undefined): StreamDisplayOptions {
  return {
    showThinking: settings?.showThinking !== false,
    showTodos: settings?.showTodos !== false,
    grouping: {
      explore: settings?.groupExploreTools !== false,
      terminal: settings?.groupTerminalCommands !== false,
      changes: settings?.groupFileChanges === true,
    },
  };
}

/** 只读命令白名单：首 token 精确匹配（小写命令原文）。 */
const READ_ONLY_HEADS = new Set([
  "ls",
  "pwd",
  "cat",
  "head",
  "tail",
  "wc",
  "grep",
  "rg",
  "find",
  "echo",
  "env",
  "which",
  "type",
  "file",
  "stat",
  "du",
  "df",
  "date",
  "uname",
  "whoami",
  "hostname",
]);

/** 只读 git 子命令（git status/diff/log/show/branch/remote）。 */
const READ_ONLY_GIT_SUBS = new Set(["status", "diff", "log", "show", "branch", "remote"]);

const ENV_ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;

/** Shell 命令只读判定：剥掉前导 sudo 与环境变量赋值（FOO=bar）后，首 token 命中
 *  只读白名单（或 git + 只读子命令）即只读；其余一律视为非只读。 */
export function isReadOnlyCommand(command: string): boolean {
  const tokens = command.trim().split(/\s+/).filter(Boolean);
  let head = 0;
  while (head < tokens.length && (tokens[head] === "sudo" || ENV_ASSIGNMENT.test(tokens[head]!))) head += 1;
  const first = tokens[head];
  if (first === undefined) return false;
  if (READ_ONLY_HEADS.has(first)) return true;
  if (first === "git") {
    const sub = tokens[head + 1];
    return sub !== undefined && READ_ONLY_GIT_SUBS.has(sub);
  }
  return false;
}

/** 工具行 → 分组类别；无类别（todo/task/其他动词、只读 Shell）返回 undefined。 */
export function categoryForRow(row: ToolRowModel): ToolGroupCategory | undefined {
  switch (row.verbKey) {
    case "tool.verb.read":
    case "tool.verb.glob":
    case "tool.verb.grep":
      return "explore";
    case "tool.verb.edit":
    case "tool.verb.write":
      return "changes";
    case "tool.verb.bash":
      // 只读命令（ls/cat/git status…）不属于 terminal 组，保持独立行并打断连续段。
      return isReadOnlyCommand(row.command ?? row.title) ? undefined : "terminal";
    default:
      return undefined;
  }
}

export type ToolDisplayItem =
  | { kind: "row"; row: ToolRowModel }
  | { kind: "group"; id: string; category: ToolGroupCategory; rows: ToolRowModel[] };

/** 有序工具行 → 行/分组显示列表：同类连续段 ≥2 聚合为一组（保留原行序），
 *  单行或被打断的段保持原行；类别被设置关闭时该行不参与分组。 */
export function groupToolRows(rows: readonly ToolRowModel[], options: ToolGroupingOptions): ToolDisplayItem[] {
  const items: ToolDisplayItem[] = [];
  let run: { category: ToolGroupCategory; rows: ToolRowModel[] } | null = null;
  const flush = (): void => {
    if (run === null) return;
    if (run.rows.length >= 2) {
      items.push({ kind: "group", id: `${run.category}:${run.rows[0]!.id}`, category: run.category, rows: run.rows });
    } else {
      items.push({ kind: "row", row: run.rows[0]! });
    }
    run = null;
  };
  for (const row of rows) {
    const category = categoryForRow(row);
    if (category === undefined || !options[category]) {
      flush();
      items.push({ kind: "row", row });
      continue;
    }
    if (run !== null && run.category === category) {
      run.rows.push(row);
    } else {
      flush();
      run = { category, rows: [row] };
    }
  }
  flush();
  return items;
}
