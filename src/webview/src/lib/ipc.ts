// 渲染层对 preload 桥的类型化封装。桥缺失（纯浏览器/测试环境）时快速失败。
import type { InnocenceCodeApi } from "../../../shared/ipc";

declare global {
  interface Window {
    innocencecode: InnocenceCodeApi;
  }
}

export const api: InnocenceCodeApi = new Proxy({} as InnocenceCodeApi, {
  get(_target, prop: string) {
    if (typeof window === "undefined" || !window.innocencecode) {
      throw new Error("preload bridge missing: window.innocencecode is unavailable");
    }
    const value = (window.innocencecode as unknown as Record<string, unknown>)[prop];
    return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(window.innocencecode) : value;
  },
});

/** 桥是否可用（测试/纯浏览器渲染时为 false，组件据此降级）。 */
export function hasBridge(): boolean {
  return typeof window !== "undefined" && !!window.innocencecode;
}
