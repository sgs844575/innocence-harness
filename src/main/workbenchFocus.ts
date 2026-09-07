// S4 工作台焦点状态（IDE 双件的内部适配）：代码面板当前查看的文件（与可
// 选焦点行）绑定到任务所属会话，供 Read 注记中间件消费。进程内单槽状态
// ——同一时刻只有一个焦点；面板切换即覆盖，会话切换后旧焦点因 sessionId
// 不匹配自然失效。
export interface WorkbenchDiagnostic {
  /** 诊断代码（TS 数值码或 LSP 字符串码）；缺省 = 无码。 */
  code?: number | string;
  /** 1 基行。 */
  line: number;
  /** 1 基列。 */
  column: number;
  message: string;
  /** 严重度（LSP 面）；进程内 TS 诊断缺省（注记按 error 语气呈现）。 */
  severity?: "error" | "warning" | "info" | "hint";
  /** 自报来源（LSP 服务器名 / 固定 "TS"）；缺省按 TS 数值码口径注记。 */
  source?: string;
}

export interface WorkbenchFocus {
  sessionId: string;
  /** Route-relative "/"-separated path（面板口径）。 */
  file: string;
  /** 可选焦点行（1 起）。 */
  line?: number;
  /** S4-LSP：焦点刷新时发现的诊断（仅新指纹；Read 命中时注记）。
   *  语言服务器波起：诊断来源含进程内 TS 与 LSP 服务器两路。 */
  diagnostics?: readonly WorkbenchDiagnostic[];
}

let current: WorkbenchFocus | undefined;

export function setWorkbenchFocus(focus: WorkbenchFocus | undefined): void {
  current = focus;
}

export function getWorkbenchFocus(): WorkbenchFocus | undefined {
  return current;
}
