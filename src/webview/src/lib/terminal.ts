// 渲染层对 preload 终端桥（window.innocencecodeTerminal）的类型化封装。
// 桥缺失（纯浏览器/测试环境）时快速失败；hasTerminalBridge 供组件降级。
import type { TerminalIpcApi } from "../../../shared/terminalIpc";

declare global {
  interface Window {
    innocencecodeTerminal: TerminalIpcApi;
  }
}

export const terminalApi: TerminalIpcApi = new Proxy({} as TerminalIpcApi, {
  get(_target, prop: string) {
    if (typeof window === "undefined" || !window.innocencecodeTerminal) {
      throw new Error("preload bridge missing: window.innocencecodeTerminal is unavailable");
    }
    const value = (window.innocencecodeTerminal as unknown as Record<string, unknown>)[prop];
    return typeof value === "function"
      ? (value as (...args: unknown[]) => unknown).bind(window.innocencecodeTerminal)
      : value;
  },
});

/** 终端桥是否可用（测试/纯浏览器渲染时为 false，组件据此降级）。 */
export function hasTerminalBridge(): boolean {
  return typeof window !== "undefined" && !!window.innocencecodeTerminal;
}
