// 右侧 dock 的纯数据/工具模块（与组件分离：组件文件混入非组件导出会让
// vite Fast Refresh 失效）。标签实例模型、标题/相对时间推导、宽度钳制。

/** dock 标签类型。 */
export type DockTabKind = "subagents" | "aux" | "review" | "file" | "terminal" | "browser";

/** 「文件」标签的载荷：修改内容（编辑/写入行的删除/新增原文）或原文（读取行结果）。 */
export interface DockFilePayload {
  /** 归一化完整路径（/ 分隔）。 */
  path: string;
  diff?: { removed: string; added: string };
  originalText?: string;
}

/** 一个打开的 dock 标签；aux 标签绑定一个 aux 会话，file 标签携带文件载荷，
 *  terminal 标签绑定一个 PTY（title = 项目目录名）。 */
export interface DockTabInstance {
  id: string;
  kind: DockTabKind;
  sessionId?: string;
  file?: DockFilePayload;
  /** 自定义标题（终端标签 = 项目目录名）。 */
  title?: string;
  /** 终端标签的工作目录（创建时固定，不随项目切换漂移）。 */
  cwd?: string;
  /** 浏览器标签的页面 favicon（data: URL）。 */
  favicon?: string;
  createdAt: number;
}

export const DEFAULT_DOCK_WIDTH = 340;
export const DOCK_MIN_WIDTH = 300;
export const DOCK_MAX_WIDTH = 640;
export const clampDockWidth = (width: number): number =>
  Math.min(DOCK_MAX_WIDTH, Math.max(DOCK_MIN_WIDTH, Math.round(width)));

/** 标签标题：辅助对话按当前存活的 aux 标签顺序动态编号（关闭即递补，默认 1）；
 *  文件标签用文件名（路径末段）；终端标签用项目目录名（title 字段）。 */
export function dockTabTitle(t: (key: string) => string, tab: DockTabInstance, tabs?: readonly DockTabInstance[]): string {
  if (tab.kind === "subagents") return t("dock.subagents");
  if (tab.kind === "review") return t("dock.tile.review");
  if (tab.kind === "terminal") return tab.title ?? t("dock.tile.terminal");
  if (tab.kind === "browser") return tab.title ?? t("dock.tile.browser");
  if (tab.kind === "file") {
    const name = tab.file?.path.split("/").filter(Boolean).pop();
    return name ?? t("dock.tile.file");
  }
  const aliveAux = (tabs ?? [tab]).filter((candidate) => candidate.kind === "aux");
  const index = aliveAux.findIndex((candidate) => candidate.id === tab.id);
  return `${t("dock.tile.chat")} ${index === -1 ? 1 : index + 1}`;
}

/** 标签列表的相对时间：刚刚 / N 分钟前 / HH:MM。 */
export function relativeTabTime(t: (key: string) => string, createdAt: number, now: number = Date.now()): string {
  const elapsed = Math.max(0, now - createdAt);
  if (elapsed < 60_000) return t("dock.time.justNow");
  if (elapsed < 3_600_000) return t("dock.time.minutesAgo").replace("{n}", String(Math.floor(elapsed / 60_000)));
  return new Date(createdAt).toTimeString().slice(0, 5);
}
