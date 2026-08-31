// S4 工作台焦点状态（IDE 双件的内部适配）：代码面板当前查看的文件（与可
// 选焦点行）绑定到任务所属会话，供 Read 注记中间件消费。进程内单槽状态
// ——同一时刻只有一个焦点；面板切换即覆盖，会话切换后旧焦点因 sessionId
// 不匹配自然失效。
export interface WorkbenchFocus {
  sessionId: string;
  /** Route-relative "/"-separated path（面板口径）。 */
  file: string;
  /** 可选焦点行（1 起）。 */
  line?: number;
  /** S4-LSP：焦点刷新时发现的诊断（仅新指纹；Read 命中时注记）。 */
  diagnostics?: readonly { code: number; line: number; column: number; message: string }[];
}

let current: WorkbenchFocus | undefined;

export function setWorkbenchFocus(focus: WorkbenchFocus | undefined): void {
  current = focus;
}

export function getWorkbenchFocus(): WorkbenchFocus | undefined {
  return current;
}
