// 应用数据根访问器：Electron userData 不再整体重定向（Chromium 缓存留在
// 默认 Roaming/<name>），应用自有数据（会话、设置、日志、任务、凭据）统一走
// 本模块持有的根 —— 默认 ~/.innocence，可被 userDataRoot 的指针文件改址。
// 必须在主入口启动早期 initAppDataRoot 一次；未初始化时取默认根（只读路径
// 组装的纯调用面不受初始化顺序影响）。electron-free，Node 可测。
import { defaultDataRoot } from "./userDataRoot";

let root: string | null = null;

/** 启动期一次性注入生效数据根（幂等：后调用覆盖，供测试重置）。 */
export function initAppDataRoot(value: string): void {
  root = value;
}

/** 生效数据根；未初始化时回落默认根（~/.innocence）。 */
export function appDataRoot(): string {
  return root ?? defaultDataRoot();
}

/** 生效数据根或 null（未初始化）—— 供可选持久化调用面做空值防护。 */
export function appDataRootOrNull(): string | null {
  return root;
}
